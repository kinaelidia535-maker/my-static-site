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
 * 递归扫描文件夹下的所有 HTML 文件，确保静态页面进入 Sitemap
 */
function getAllHtmlFiles(dirPath, arrayOfFiles) {
  const files = fs.readdirSync(dirPath);
  arrayOfFiles = arrayOfFiles || [];

  files.forEach(function(file) {
    const fullPath = path.join(dirPath, file);
    if (fs.statSync(fullPath).isDirectory()) {
      const includeDirs = ['ru', 'zh', 'news', 'dynamics', 'knowledge', 'products'];
      if (includeDirs.includes(file)) {
        arrayOfFiles = getAllHtmlFiles(fullPath, arrayOfFiles);
      }
    } else {
      if (file.endsWith(".html") && !file.startsWith('template')) {
        const urlPath = fullPath.replace(/\\/g, '/').replace(/^\./, '');
        arrayOfFiles.push(urlPath);
      }
    }
  });

  return arrayOfFiles;
}

/**
 * Sitemap 生成
 */
function generateSitemap(allEnArticles, allRuArticles) {
  const domain = 'https://www.mos-surfactant.com';
  const lastMod = new Date().toISOString().split('T')[0];
  const staticUrls = getAllHtmlFiles('./');

  let xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`;

  staticUrls.forEach(url => {
    const priority = url.endsWith('index.html') ? '1.0' : '0.8';
    xml += `\n  <url><loc>${domain}${url}</loc><lastmod>${lastMod}</lastmod><priority>${priority}</priority></url>`;
  });

  [...allEnArticles, ...allRuArticles].forEach(item => {
    xml += `\n  <url><loc>${domain}${item.url}</loc><lastmod>${item.date || lastMod}</lastmod><priority>0.6</priority></url>`;
  });

  xml += `\n</urlset>`;
  
  if (!fs.existsSync('./dist')) fs.mkdirSync('./dist');
  fs.writeFileSync('./dist/sitemap.xml', xml);
  console.log(`🚀 Sitemap.xml 生成成功！`);
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

    // 处理列表数据（data.json 将被 index.html 和 news.html 共同使用）
    const indexData = allEntries.map(item => {
      let thumbUrl = item.fields.featuredImage?.fields?.file?.url;
      const altText = item.fields.imgAlt || item.fields.title; 

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
        img: thumbUrl, // 虽然 index 不显示，但 news.html 列表可能需要
        alt: altText,
        category: cat // 显式添加分类，方便前端过滤
      };
    });

    // 核心修复：将全量数据写入 data.json，这样 news.html 才能获取到最新文章
    fs.writeFileSync(`${langBaseDir}/data.json`, JSON.stringify(indexData));

    if (isEn) allEnForSitemap = indexData;
    else allRuForSitemap = indexData;

    const templatePath = isEn ? `./template.html` : `./template_ru.html`;
    const template = fs.readFileSync(fs.existsSync(templatePath) ? templatePath : './template.html', 'utf8');

    // 核心修复：动态分类组，确保所有分类都被扫到
    const groups = {};
    allEntries.forEach(item => {
      const cat = (item.fields.category || 'dynamics').toLowerCase();
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(item);
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
          .replace(/{{IMG_ALT}}/g, currentAlt)
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
  console.log('✅ 构建完成，新闻已同步至列表数据。');
}

run().catch(error => {
    console.error("❌ 构建失败:", error);
    process.exit(1);
});
