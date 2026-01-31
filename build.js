const contentful = require('contentful');
const fs = require('fs');
const path = require('path');
const { documentToHtmlString } = require('@contentful/rich-text-html-renderer');

const client = contentful.createClient({
  space: process.env.CONTENTFUL_SPACE_ID,
  accessToken: process.env.CONTENTFUL_ACCESS_TOKEN
});

const locales = ['en-US', 'ru'];

// --- 俄文分类翻译表 ---
const ruCategoryMap = {
    'dynamics': 'Динамика',
    'knowledge': 'Знания',
    'news': 'Новости'
};

// --- 工具函数：文件夹递归拷贝 ---
function copyFolderSync(from, to) {
  if (!fs.existsSync(from)) return;
  if (!fs.existsSync(to)) fs.mkdirSync(to, { recursive: true });
  fs.readdirSync(from).forEach(element => {
    if (fs.lstatSync(path.join(from, element)).isFile()) {
      fs.copyFileSync(path.join(from, element), path.join(to, element));
    } else {
      copyFolderSync(path.join(from, element), path.join(to, element));
    }
  });
}

// --- 工具函数：随机图片 ---
function getRandomLocalImage() {
  const randomNum = Math.floor(Math.random() * 43) + 1;
  const paddedNum = randomNum.toString().padStart(2, '0');
  return `/imgs/article_imgs/${paddedNum}.png`;
}

// --- 核心修改：追加式生成 Sitemap（新 URL 排在最前面） ---
function updateSitemapAppended(allNewArticles) {
  const sourceSitemap = './sitemap1.xml';  // 原始备份文件
  const distSitemap = './dist/sitemap.xml'; // 部署用的标准文件名
  const domain = 'https://www.mos-surfactant.com';
  const lastMod = new Date().toISOString().split('T')[0];
  
  let oldEntries = [];      // 存放已有记录
  let newEntries = [];      // 存放本次发现的新记录
  let existingLocs = new Set();

  // 1. 读取原始 sitemap1.xml 中的记录，用于去重和保留旧链接
  if (fs.existsSync(sourceSitemap)) {
    const content = fs.readFileSync(sourceSitemap, 'utf8');
    const urlBlockRegex = /<url>[\s\S]*?<\/url>/g;
    const matches = content.match(urlBlockRegex) || [];
    
    matches.forEach(block => {
      const locMatch = block.match(/<loc>(.*?)<\/loc>/);
      if (locMatch) {
        const url = locMatch[1].trim();
        if (!existingLocs.has(url)) {
          existingLocs.add(url);
          oldEntries.push(block.trim()); // 旧记录保持原样
        }
      }
    });
    console.log(`已从 sitemap1.xml 加载 ${existingLocs.size} 条历史记录。`);
  }

  // 2. 识别来自 Contentful 的新文章链接
  allNewArticles.forEach(item => {
    const fullUrl = `${domain}${item.url}`;
    if (!existingLocs.has(fullUrl)) {
      const newEntry = `  <url>\n    <loc>${fullUrl}</loc>\n    <lastmod>${lastMod}</lastmod>\n    <priority>0.8</priority>\n  </url>`;
      newEntries.push(newEntry); // 新文章放入新数组
      existingLocs.add(fullUrl);
      console.log(`新增 URL (置顶): ${fullUrl}`);
    }
  });

  // 3. 重新组装 XML：【关键】newEntries 在前，oldEntries 在后
  const finalXml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${newEntries.join('\n')}
${oldEntries.join('\n')}
</urlset>`;
  
  // 4. 双写更新：更新部署目录和根目录备份
  fs.writeFileSync(distSitemap, finalXml);
  fs.writeFileSync(sourceSitemap, finalXml); 
  console.log(`✅ Sitemap 更新完成。本次置顶 ${newEntries.length} 条，总计 ${existingLocs.size} 条。`);
}

// --- 主运行函数 ---
async function run() {
  if (!fs.existsSync('./dist')) fs.mkdirSync('./dist', { recursive: true });

  // 拷贝资源文件夹
  const foldersToCopy = ['imgs', 'flags', 'news', 'dynamics', 'knowledge', 'products', 'ru', 'zh'];
  foldersToCopy.forEach(folder => {
    if (fs.existsSync(`./${folder}`)) copyFolderSync(`./${folder}`, `./dist/${folder}`);
  });
  
  // 拷贝基础静态文件
  const filesToCopy = ['script.js', 'styles.css', 'robots.txt', 'favicon.ico'];
  filesToCopy.forEach(file => {
    if (fs.existsSync(`./${file}`)) fs.copyFileSync(`./${file}`, `./dist/${file}`);
  });

  let allArticlesForSitemap = [];

  for (const locale of locales) {
    const isEn = locale === 'en-US';
    console.log(`正在从 Contentful 抓取 [${locale}] 数据...`);

    const response = await client.getEntries({ 
      content_type: 'master', 
      locale: locale, 
      order: '-sys.createdAt' 
    });
    
    const allEntries = response.items;
    if (allEntries.length === 0) continue;

    const langBaseDir = isEn ? `./dist` : `./dist/ru`;
    if (!fs.existsSync(langBaseDir)) fs.mkdirSync(langBaseDir, { recursive: true });

    // 1. 生成 data.json
    const indexData = allEntries.map(item => {
      const catRaw = (item.fields.category || 'dynamics').trim();
      const catLower = catRaw.toLowerCase();
      const articleUrl = isEn ? `/${catLower}/${item.fields.slug}.html` : `/ru/${catLower}/${item.fields.slug}.html`;
      
      let finalImg = '';
      const ctfImg = item.fields.featuredImage?.fields?.file?.url;
      if (ctfImg) {
        finalImg = ctfImg.startsWith('//') ? 'https:' + ctfImg : ctfImg;
      } else {
        finalImg = getRandomLocalImage();
      }

      return {
        title: item.fields.title,
        summary: item.fields.summary || '', 
        date: item.fields.datedTime,
        url: articleUrl,
        img: finalImg,
        alt: item.fields.imgAlt || item.fields.title,
        category: catLower
      };
    });
    fs.writeFileSync(`${langBaseDir}/data.json`, JSON.stringify(indexData));
    
    // 汇总所有语言的文章链接
    allArticlesForSitemap = allArticlesForSitemap.concat(indexData);

    // 2. 生成详情页 HTML
    const templatePath = isEn ? `./template.html` : `./template_ru.html`;
    const templateContent = fs.readFileSync(fs.existsSync(templatePath) ? templatePath : './template.html', 'utf8');

    const groups = {};
    allEntries.forEach(item => {
      const cat = (item.fields.category || 'dynamics').trim();
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(item);
    });

    for (const [catRaw, items] of Object.entries(groups)) {
      items.forEach((item, i) => {
        const { title, body, slug, datedTime, imgAlt, summary } = item.fields;
        const contentHtml = documentToHtmlString(body);
        
        const catLower = catRaw.toLowerCase();
        let catDisplay = catRaw; 
        if (!isEn) {
            catDisplay = ruCategoryMap[catLower] || catRaw;
        }
        const catUpper = catDisplay.toUpperCase();
        
        const domain = "https://www.mos-surfactant.com";
        const sharePath = isEn ? `/${catLower}/${slug}.html` : `/ru/${catLower}/${slug}.html`;
        const pageUrl = encodeURIComponent(`${domain}${sharePath}`);

        let html = templateContent
          .replace(/{{TITLE}}/g, title)
          .replace(/{{CONTENT}}/g, contentHtml)
          .replace(/{{DATE}}/g, datedTime)
          .replace(/{{SLUG}}/g, slug)
          .replace(/{{IMG_ALT}}/g, imgAlt || title)
          .replace(/{{SUMMARY}}/g, summary || title)
          .replace(/{{CATEGORY}}/g, catRaw)
          .replace(/{{CATEGORY_LOWER}}/g, catLower)
          .replace(/{{CATEGORY_UPPER}}/g, catUpper)
          .replace(/{{ARTICLE_PATH}}/g, sharePath)
          .replace(/{{LINKEDIN_SHARE}}/g, `https://www.linkedin.com/sharing/share-offsite/?url=${pageUrl}`)
          .replace(/{{FACEBOOK_SHARE}}/g, `https://www.facebook.com/sharer/sharer.php?u=${pageUrl}`)
          .replace(/{{WHATSAPP_SHARE}}/g, `https://api.whatsapp.com/send?text=${encodeURIComponent(title)}%20${pageUrl}`)
          .replace(/{{TWITTER_SHARE}}/g, `https://twitter.com/intent/tweet?text=${encodeURIComponent(title)}&url=${pageUrl}`);

        const nextPost = items[i - 1]; 
        const prevPost = items[i + 1];
        html = html.replace('{{PREV_LINK}}', prevPost ? `${prevPost.fields.slug}.html` : '#')
                   .replace('{{PREV_TITLE}}', prevPost ? prevPost.fields.title : 'None')
                   .replace('{{NEXT_LINK}}', nextPost ? `${nextPost.fields.slug}.html` : '#')
                   .replace('{{NEXT_TITLE}}', nextPost ? nextPost.fields.title : 'No newer posts');

        const outDir = `${langBaseDir}/${catLower}`;
        if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
        fs.writeFileSync(`${outDir}/${slug}.html`, html);
      });
    }
  }

  // 执行置顶式 Sitemap 追加
  updateSitemapAppended(allArticlesForSitemap);
  console.log('🚀 构建流程完美结束！');
}

run().catch(error => {
    console.error("❌ 构建失败:", error);
    process.exit(1);
});
