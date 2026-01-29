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
 * 核心功能：递归扫描文件夹下的所有 HTML 文件
 * 确保 /zh/ 和 /ru/ 文件夹里的静态页面都能进入 Sitemap
 */
function getAllHtmlFiles(dirPath, arrayOfFiles) {
  const files = fs.readdirSync(dirPath);
  arrayOfFiles = arrayOfFiles || [];

  files.forEach(function(file) {
    const fullPath = path.join(dirPath, file);
    if (fs.statSync(fullPath).isDirectory()) {
      // 扫描包含页面内容的特定目录
      const includeDirs = ['ru', 'zh', 'news', 'dynamics', 'knowledge', 'products'];
      if (includeDirs.includes(file)) {
        arrayOfFiles = getAllHtmlFiles(fullPath, arrayOfFiles);
      }
    } else {
      // 匹配 .html 文件并排除模板
      if (file.endsWith(".html") && !file.startsWith('template')) {
        const urlPath = fullPath.replace(/\\/g, '/').replace(/^\./, '');
        arrayOfFiles.push(urlPath);
      }
    }
  });

  return arrayOfFiles;
}

/**
 * Sitemap 生成：包含全量静态扫描结果 + Contentful 动态文章
 */
function generateSitemap(allEnArticles, allRuArticles) {
  const domain = 'https://www.mos-surfactant.com';
  const lastMod = new Date().toISOString().split('T')[0];
  
  const staticUrls = getAllHtmlFiles('./');

  let xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`;

  // 1. 写入扫描到的所有静态页面（含 ZH/RU 目录下的存量页面）
  staticUrls.forEach(url => {
    const priority = url.endsWith('index.html') ? '1.0' : '0.8';
    xml += `\n  <url><loc>${domain}${url}</loc><lastmod>${lastMod}</lastmod><priority>${priority}</priority></url>`;
  });

  // 2. 写入 Contentful 动态生成的详情页
  [...allEnArticles, ...allRuArticles].forEach(item => {
    xml += `\n  <url><loc>${domain}${item.url}</loc><lastmod>${item.date || lastMod}</lastmod><priority>0.6</priority></url>`;
  });

  xml += `\n</urlset>`;
  
  if (!fs.existsSync('./dist')) fs.mkdirSync('./dist');
  fs.writeFileSync('./dist/sitemap.xml', xml);
  console.log(`🚀 Sitemap.xml 生成成功，包含 ${staticUrls.length + allEnArticles.length + allRuArticles.length} 个链接。`);
}

async function run() {
  if (!fs.existsSync('./dist')) fs.mkdirSync('./dist', { recursive: true });

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

    // 处理列表数据并提取 imgAlt
    const indexData = allEntries.map(item => {
      let thumbUrl = item.fields.featuredImage?.fields?.file?.url;
      const altText = item.fields.imgAlt || item.fields.title; // 提取 imgAlt 字段

      if (!thumbUrl) {
        const randomNum = String(Math.floor(Math.random() * 43) + 1).padStart(2, '0');
        thumbUrl = `/imgs/article_imgs/${randomNum}.png`;
      } else if (thumbUrl.startsWith('//')) {
        thumbUrl = 'https:' + thumbUrl;
      }

      const cat = (item.fields.category || 'dynamics').toLowerCase();
      const articleUrl = isEn ? `/${cat}/${item.fields.slug}.html` : `/ru/${cat}/${item.fields.slug}.html`;

      return {
        title: item.fields.title,
        summary: item.fields.summary || '', 
        date: item.fields.datedTime,
        url: articleUrl,
        img: thumbUrl,
        alt: altText // 存入 JSON 供 index/dynamics 等页面渲染
      };
    });

    fs.writeFileSync(`${langBaseDir}/data.json`, JSON.stringify(indexData));

    if (isEn) allEnForSitemap = indexData;
    else allRuForSitemap = indexData;

    // 渲染文章详情页
    const templatePath = isEn ? `./template.html` : `./template_ru.html`;
    const template = fs.readFileSync(fs.existsSync(templatePath) ? templatePath : './template.html', 'utf8');

    const groups = { dynamics: [], news: [], knowledge: [] };
    allEntries.forEach(item => {
      const cat = (item.fields.category || 'dynamics').toLowerCase();
      if (groups[cat]) groups[cat].push(item);
    });

    for (const [catName, items] of Object.entries(groups)) {
      items.forEach((item, i) => {
        const { title, body, slug, datedTime, imgAlt } = item.fields;
        const currentAlt = imgAlt || title; 
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
          .replace(/{{IMG_ALT}}/g, currentAlt) // 详情页模板替换
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

  generateSitemap(allEnForSitemap, allRuForSitemap);
  console.log('✅ 构建任务全部完成！');
}

run().catch(error => {
    console.error("❌ 构建失败:", error);
    process.exit(1);
});
