const contentful = require('contentful');
const fs = require('fs');
const path = require('path');
const { documentToHtmlString } = require('@contentful/rich-text-html-renderer');

const client = contentful.createClient({
  space: process.env.CONTENTFUL_SPACE_ID,
  accessToken: process.env.CONTENTFUL_ACCESS_TOKEN
});

const locales = ['en-US', 'ru'];

/**
 * 核心新增：递归扫描文件夹下的所有 HTML 文件
 * 这样可以自动把 /zh/ 和 /ru/ 文件夹里的旧页面也加进 Sitemap
 */
function getAllHtmlFiles(dirPath, arrayOfFiles) {
  const files = fs.readdirSync(dirPath);
  arrayOfFiles = arrayOfFiles || [];

  files.forEach(function(file) {
    const fullPath = path.join(dirPath, file);
    if (fs.statSync(fullPath).isDirectory()) {
      // 只扫描特定的语种和内容文件夹，排除 dist, imgs, node_modules 等
      const includeDirs = ['ru', 'zh', 'news', 'dynamics', 'knowledge', 'products'];
      if (includeDirs.includes(file)) {
        arrayOfFiles = getAllHtmlFiles(fullPath, arrayOfFiles);
      }
    } else {
      // 匹配所有 .html 文件，但排除模板文件
      if (file.endsWith(".html") && !file.startsWith('template')) {
        // 格式化为 URL 路径，例如: /zh/index.html
        const urlPath = fullPath.replace(/\\/g, '/').replace(/^\./, '');
        arrayOfFiles.push(urlPath);
      }
    }
  });

  return arrayOfFiles;
}

// Sitemap 生成函数
function generateSitemap(allEnArticles, allRuArticles) {
  const domain = 'https://www.mos-surfactant.com';
  const lastMod = new Date().toISOString().split('T')[0];
  
  // 1. 深度扫描本地所有 HTML 文件（含 zh, ru 目录）
  const staticUrls = getAllHtmlFiles('./');

  let xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`;

  // 2. 写入扫描到的所有静态页面
  staticUrls.forEach(url => {
    // 首页设置最高权重
    const priority = url.endsWith('index.html') ? '1.0' : '0.8';
    xml += `\n  <url><loc>${domain}${url}</loc><lastmod>${lastMod}</lastmod><priority>${priority}</priority></url>`;
  });

  // 3. 写入从 Contentful 抓取的动态文章 (EN)
  allEnArticles.forEach(item => {
    xml += `\n  <url><loc>${domain}${item.url}</loc><lastmod>${item.date || lastMod}</lastmod><priority>0.6</priority></url>`;
  });

  // 4. 写入从 Contentful 抓取的动态文章 (RU)
  allRuArticles.forEach(item => {
    xml += `\n  <url><loc>${domain}${item.url}</loc><lastmod>${item.date || lastMod}</lastmod><priority>0.6</priority></url>`;
  });

  xml += `\n</urlset>`;
  
  // 确保写入 dist 根目录
  fs.writeFileSync('./dist/sitemap.xml', xml);
  console.log(`🚀 Sitemap.xml 已补全生成！共包含 ${staticUrls.length + allEnArticles.length + allRuArticles.length} 个链接。`);
}

async function run() {
  if (!fs.existsSync('./dist')) fs.mkdirSync('./dist');

  let allEnForSitemap = [];
  let allRuForSitemap = [];

  for (const locale of locales) {
    const isEn = locale === 'en-US';
    console.log(`正在处理语言 [${locale}]...`);

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
      let thumbUrl = item.fields.featuredImage?.fields?.file?.url;
      if (!thumbUrl) {
        const randomNum = String(Math.floor(Math.random() * 43) + 1).padStart(2, '0');
        thumbUrl = `/imgs/article_imgs/${randomNum}.png`;
      }
      const cat = (item.fields.category || 'dynamics').toLowerCase();
      const articleUrl = isEn ? `/${cat}/${item.fields.slug}.html` : `/ru/${cat}/${item.fields.slug}.html`;

      return {
        title: item.fields.title,
        summary: item.fields.summary || '', 
        date: item.fields.datedTime,
        url: articleUrl,
        img: thumbUrl
      };
    });
    fs.writeFileSync(`${langBaseDir}/data.json`, JSON.stringify(indexData));

    if (isEn) allEnForSitemap = indexData;
    else allRuForSitemap = indexData;

    // 2. 生成详情页
    const templatePath = isEn ? `./template.html` : `./template_ru.html`;
    const template = fs.readFileSync(fs.existsSync(templatePath) ? templatePath : './template.html', 'utf8');

    const groups = { dynamics: [], news: [], knowledge: [] };
    allEntries.forEach(item => {
      const cat = (item.fields.category || 'dynamics').toLowerCase();
      if (groups[cat]) groups[cat].push(item);
      else groups[cat] = [item];
    });

    for (const [catName, items] of Object.entries(groups)) {
      items.forEach((item, i) => {
        const { title, body, slug, datedTime } = item.fields;
        const contentHtml = documentToHtmlString(body);
        const nextPost = items[i - 1]; 
        const prevPost = items[i + 1];
        const domain = "https://www.mos-surfactant.com";
        const sharePath = isEn ? `/${catName}/${slug}.html` : `/ru/${catName}/${slug}.html`;
        const pageUrl = encodeURIComponent(`${domain}${sharePath}`);

        let html = template
          .replace(/{{TITLE}}/g, title)
          .replace(/{{CONTENT}}/g, contentHtml)
          .replace(/{{DATE}}/g, datedTime)
          .replace(/{{SLUG}}/g, slug)
          .replace(/{{CATEGORY}}/g, catName)
          .replace(/{{LINKEDIN_SHARE}}/g, `https://www.linkedin.com/sharing/share-offsite/?url=${pageUrl}`)
          .replace(/{{FACEBOOK_SHARE}}/g, `https://www.facebook.com/sharer/sharer.php?u=${pageUrl}`)
          .replace(/{{WHATSAPP_SHARE}}/g, `https://api.whatsapp.com/send?text=${encodeURIComponent(title)}%20${pageUrl}`)
          .replace(/{{TWITTER_SHARE}}/g, `https://twitter.com/intent/tweet?text=${encodeURIComponent(title)}&url=${pageUrl}`);

        html = html.replace('{{PREV_LINK}}', prevPost ? `${prevPost.fields.slug}.html` : '#')
                   .replace('{{PREV_TITLE}}', prevPost ? prevPost.fields.title : 'None')
                   .replace('{{NEXT_LINK}}', nextPost ? `${nextPost.fields.slug}.html` : '#')
                   .replace('{{NEXT_TITLE}}', nextPost ? nextPost.fields.title : 'No newer posts');

        const outDir = `${langBaseDir}/${catName}`;
        if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
        fs.writeFileSync(`${outDir}/${slug}.html`, html);
      });
    }
  }

  // 最终生成 Sitemap
  generateSitemap(allEnForSitemap, allRuForSitemap);
  console.log('所有语种及全量 Sitemap 生成完成！');
}

run().catch(error => {
    console.error("构建失败:", error);
    process.exit(1);
});
