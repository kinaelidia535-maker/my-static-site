const contentful = require('contentful');
const fs = require('fs');
const { documentToHtmlString } = require('@contentful/rich-text-html-renderer');

const client = contentful.createClient({
  space: process.env.CONTENTFUL_SPACE_ID,
  accessToken: process.env.CONTENTFUL_ACCESS_TOKEN
});

const locales = ['en-US', 'ru'];

// 静态页面配置（用于生成 Sitemap）
const staticPages = [
  'index.html', 'company.html', 'contact.html', 'culture.html', 
  'dynamics.html', 'news.html', 'knowledge.html', 'products.html'
];

// Sitemap 生成函数
function generateSitemap(allEnArticles, allRuArticles) {
  const domain = 'https://www.mos-surfactant.com';
  const lastMod = new Date().toISOString().split('T')[0];

  let xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`;

  // 1. 添加静态页面（双语）
  staticPages.forEach(page => {
    // 英文根目录
    xml += `\n  <url><loc>${domain}/${page}</loc><lastmod>${lastMod}</lastmod><priority>0.8</priority></url>`;
    // 俄文目录
    xml += `\n  <url><loc>${domain}/ru/${page}</loc><lastmod>${lastMod}</lastmod><priority>0.7</priority></url>`;
  });

  // 2. 添加动态文章（英文）
  allEnArticles.forEach(item => {
    xml += `\n  <url><loc>${domain}${item.url}</loc><lastmod>${item.date || lastMod}</lastmod><priority>0.6</priority></url>`;
  });

  // 3. 添加动态文章（俄文）
  allRuArticles.forEach(item => {
    xml += `\n  <url><loc>${domain}${item.url}</loc><lastmod>${item.date || lastMod}</lastmod><priority>0.6</priority></url>`;
  });

  xml += `\n</urlset>`;
  fs.writeFileSync('./dist/sitemap.xml', xml);
  console.log('🚀 Sitemap.xml 已成功生成至 dist 根目录');
}

async function run() {
  if (!fs.existsSync('./dist')) fs.mkdirSync('./dist');

  // 用于收集所有文章数据以生成 Sitemap
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

    // 收集给 Sitemap 使用
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

  // 最后一步：生成 Sitemap
  generateSitemap(allEnForSitemap, allRuForSitemap);
  console.log('所有语种及 Sitemap 生成完成！');
}

run().catch(error => {
    console.error("构建失败:", error);
    process.exit(1);
});
