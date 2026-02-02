const contentful = require('contentful');
const fs = require('fs');
const path = require('path');
const { documentToHtmlString } = require('@contentful/rich-text-html-renderer');

// --- 客户端配置 ---
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

// --- 核心逻辑：追加式生成 Sitemap（置顶新 URL） ---
function updateSitemapAppended(allNewArticles) {
  const sourceSitemap = './sitemap1.xml'; 
  const distSitemap = './dist/sitemap.xml'; 
  const domain = 'https://www.mos-surfactant.com';
  const lastMod = new Date().toISOString().split('T')[0];
  
  let oldEntries = [];      
  let newEntries = [];      
  let existingLocs = new Set();

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
          oldEntries.push(block.trim());
        }
      }
    });
  }

  allNewArticles.forEach(item => {
    const fullUrl = `${domain}${item.url}`;
    if (!existingLocs.has(fullUrl)) {
      const newEntry = `  <url>\n    <loc>${fullUrl}</loc>\n    <lastmod>${lastMod}</lastmod>\n    <priority>0.8</priority>\n  </url>`;
      newEntries.push(newEntry);
      existingLocs.add(fullUrl);
      console.log(`[Sitemap] 新增 URL: ${fullUrl}`);
    }
  });

  const finalXml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${newEntries.join('\n')}
${oldEntries.join('\n')}
</urlset>`;
  
  fs.writeFileSync(distSitemap, finalXml);
  fs.writeFileSync(sourceSitemap, finalXml); 
  console.log(`✅ Sitemap 处理完成：共计 ${existingLocs.size} 条链接。`);
}

// --- 主运行函数 ---
async function run() {
  // 清理并创建 dist
  if (!fs.existsSync('./dist')) fs.mkdirSync('./dist', { recursive: true });

  // 1. 拷贝静态资源
  const foldersToCopy = ['imgs', 'flags', 'news', 'dynamics', 'knowledge', 'products', 'ru', 'zh'];
  foldersToCopy.forEach(folder => {
    if (fs.existsSync(`./${folder}`)) copyFolderSync(`./${folder}`, `./dist/${folder}`);
  });
  
  const filesToCopy = ['script.js', 'styles.css', 'robots.txt', 'favicon.ico'];
  filesToCopy.forEach(file => {
    if (fs.existsSync(`./${file}`)) fs.copyFileSync(`./${file}`, `./dist/${file}`);
  });

  let totalArticlesForSitemap = [];

  // 2. 循环处理不同语言
  for (const locale of locales) {
    const isEn = locale === 'en-US';
    const langLabel = isEn ? "English" : "Russian";
    console.log(`\n--- 正在构建 ${langLabel} 站点 ---`);

    const response = await client.getEntries({ 
      content_type: 'master', 
      locale: locale, 
      order: '-sys.createdAt' 
    });
    
    // 【核心修正】：语言隔离过滤
    // 只有当条目在当前 locale 下拥有真正的标题时，才允许进入该语言的站点数据
    const validEntries = response.items.filter(item => {
        // 关键：检查该字段是否在该语言下真实存在（防止 Fallback 机制污染）
        return item.fields && item.fields.title && item.fields.title.trim() !== "";
    });

    if (validEntries.length === 0) {
        console.log(`⚠️  ${langLabel} 没有任何有效文章，跳过。`);
        continue;
    }

    const langBaseDir = isEn ? `./dist` : `./dist/ru`;
    if (!fs.existsSync(langBaseDir)) fs.mkdirSync(langBaseDir, { recursive: true });

    // A. 准备 data.json 数据
    const langData = validEntries.map(item => {
      const catRaw = (item.fields.category || 'dynamics').trim();
      const catLower = catRaw.toLowerCase();
      // 根据语言确定 URL 路径前缀
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

    // 写入对应的物理目录
    fs.writeFileSync(`${langBaseDir}/data.json`, JSON.stringify(langData));
    console.log(`✅ ${langLabel} 数据索引已保存: ${langBaseDir}/data.json (${langData.length} 篇文章)`);
    
    // 汇总给 Sitemap
    totalArticlesForSitemap = totalArticlesForSitemap.concat(langData);

    // B. 生成详情页 HTML
    const templatePath = isEn ? `./template.html` : `./template_ru.html`;
    const templateContent = fs.readFileSync(fs.existsSync(templatePath) ? templatePath : './template.html', 'utf8');

    const groups = {};
    validEntries.forEach(item => {
      const cat = (item.fields.category || 'dynamics').trim();
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(item);
    });

    for (const [catRaw, items] of Object.entries(groups)) {
      items.forEach((item, i) => {
        const { title, body, slug, datedTime, imgAlt, summary } = item.fields;
        const contentHtml = documentToHtmlString(body);
        const catLower = catRaw.toLowerCase();
        
        // 分类翻译
        let catDisplay = catRaw; 
        if (!isEn) catDisplay = ruCategoryMap[catLower] || catRaw;
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

        // 上下篇逻辑
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

  // 3. 生成 Sitemap
  updateSitemapAppended(totalArticlesForSitemap);
  console.log('\n🚀 [Build Complete] 英俄双站物理隔离构建已圆满结束！');
}

run().catch(error => {
    console.error("❌ 构建过程中出现致命错误:", error);
    process.exit(1);
});
