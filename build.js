const contentful = require('contentful');
const fs = require('fs');
const path = require('path');
const { documentToHtmlString } = require('@contentful/rich-text-html-renderer');

const client = contentful.createClient({
  space: process.env.CONTENTFUL_SPACE_ID,
  accessToken: process.env.CONTENTFUL_ACCESS_TOKEN
});

const locales = ['en-US', 'ru'];

// 递归扫描 HTML 文件 (保持不变)
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

// Sitemap 生成函数 (保持不变)
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
  fs.writeFileSync('./dist/sitemap.xml', xml);
  console.log(`🚀 Sitemap.xml 已补全生成！`);
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

    // --- 修改点 1：在生成 data.json 时提取 imgAlt ---
    const indexData = allEntries.map(item => {
      let thumbUrl = item.fields.featuredImage?.fields?.file?.url;
      // 提取你新增的 imgAlt 字段，如果没有填，则默认使用标题
      const altText = item.fields.imgAlt || item.fields.title; 
      
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
        img: thumbUrl,
        alt: altText // 存入 JSON 供首页等调用
      };
    });
    fs.writeFileSync(`${langBaseDir}/data.json`, JSON.stringify(indexData));

    if (isEn) allEnForSitemap = indexData;
    else allRuForSitemap = indexData;

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
        // --- 修改点 2：在渲染详情页时提取 imgAlt 并执行替换 ---
        const { title, body, slug, datedTime, imgAlt } = item.fields;
        const currentAlt = imgAlt || title; // 备用方案：没填 Alt 就用标题
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
          .replace(/{{IMG_ALT}}/g, currentAlt) // 替换模板中的图片 Alt 占位符
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
  console.log('所有语种及全量 Sitemap 生成完成！');
}

run().catch(error => {
    console.error("构建失败:", error);
    process.exit(1);
});
