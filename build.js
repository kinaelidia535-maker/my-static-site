const contentful = require('contentful');
const fs = require('fs');
const path = require('path');
const { documentToHtmlString } = require('@contentful/rich-text-html-renderer');

const client = contentful.createClient({
  space: process.env.CONTENTFUL_SPACE_ID,
  accessToken: process.env.CONTENTFUL_ACCESS_TOKEN
});

const locales = ['en-US', 'ru'];

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

// --- 工具函数：随机获取本地图片 ---
function getRandomLocalImage() {
  const randomNum = Math.floor(Math.random() * 43) + 1;
  const paddedNum = randomNum.toString().padStart(2, '0');
  return `/imgs/article_imgs/${paddedNum}.png`;
}

// --- 工具函数：追加式生成 Sitemap (核心修改) ---
function updateSitemapAppended(allNewArticles) {
  const sitemapPath = './sitemap.xml'; // 根目录下的原始文件
  const distSitemapPath = './dist/sitemap.xml';
  const domain = 'https://www.mos-surfactant.com';
  const lastMod = new Date().toISOString().split('T')[0];
  
  let existingUrls = new Set();
  let urlEntries = [];

  // 1. 读取现有 sitemap.xml 内容 (如果存在)
  if (fs.existsSync(sitemapPath)) {
    const content = fs.readFileSync(sitemapPath, 'utf8');
    // 使用正则简单提取现有的 <url> 部分
    const urlRegex = /<url>[\s\S]*?<\/url>/g;
    const matches = content.match(urlRegex) || [];
    matches.forEach(m => {
        // 提取 loc 标签内容用于去重判断
        const locMatch = m.match(/<loc>(.*?)<\/loc>/);
        if (locMatch) {
            existingUrls.add(locMatch[1].trim());
            urlEntries.push(m.trim());
        }
    });
  }

  // 2. 将 Contentful 新生成的文章追加进去
  allNewArticles.forEach(item => {
    const fullUrl = `${domain}${item.url}`;
    if (!existingUrls.has(fullUrl)) {
      const newEntry = `  <url>\n    <loc>${fullUrl}</loc>\n    <lastmod>${lastMod}</lastmod>\n    <priority>0.8</priority>\n  </url>`;
      urlEntries.push(newEntry);
      existingUrls.add(fullUrl);
    }
  });

  // 3. 重新组装 XML
  let xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`;
  xml += `\n${urlEntries.join('\n')}`;
  xml += `\n</urlset>`;
  
  // 同时写回根目录(保留更新)和写入 dist 目录(用于部署)
  fs.writeFileSync(distSitemapPath, xml);
  fs.writeFileSync(sitemapPath, xml); 
  console.log(`✅ Sitemap 追加完成，当前总计 ${urlEntries.length} 个页面。`);
}

// --- 主运行函数 ---
async function run() {
  if (!fs.existsSync('./dist')) fs.mkdirSync('./dist', { recursive: true });

  // 基础资源拷贝
  const foldersToCopy = ['imgs', 'flags', 'news', 'dynamics', 'knowledge', 'products', 'ru', 'zh'];
  foldersToCopy.forEach(folder => {
    if (fs.existsSync(`./${folder}`)) copyFolderSync(`./${folder}`, `./dist/${folder}`);
  });
  
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
    
    // 汇总所有文章用于更新 Sitemap
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
        const catUpper = catRaw.toUpperCase();
        
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

  // 执行追加式 Sitemap 更新
  updateSitemapAppended(allArticlesForSitemap);
  console.log('🚀 构建完成！');
}

run().catch(error => {
    console.error("❌ 构建失败:", error);
    process.exit(1);
});
