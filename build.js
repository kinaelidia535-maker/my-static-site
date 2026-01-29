const contentful = require('contentful');
const fs = require('fs');
const { documentToHtmlString } = require('@contentful/rich-text-html-renderer');

const client = contentful.createClient({
  space: process.env.CONTENTFUL_SPACE_ID,
  accessToken: process.env.CONTENTFUL_ACCESS_TOKEN
});

const locales = ['en-US', 'ru'];

// --- 修改点：不再写死页面列表，改为自动扫描函数 ---
function getStaticPages() {
    // 扫描当前根目录下所有的 .html 文件，排除掉模板文件
    return fs.readdirSync('./').filter(file => 
        file.endsWith('.html') && 
        !file.startsWith('template')
    );
}

// --- 修改后的 Sitemap 生成函数：全量覆盖扫描 ---
function generateSitemap(allEnArticles, allRuArticles) {
  const domain = 'https://www.mos-surfactant.com';
  const lastMod = new Date().toISOString().split('T')[0];
  
  // 自动获取根目录所有的静态 HTML (包含 index, news, 甚至你之前的 zh 页面等)
  const staticFiles = getStaticPages();

  let xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`;

  // 1. 添加所有根目录下的静态页面链接
  staticFiles.forEach(page => {
    // 英文版
    xml += `\n  <url><loc>${domain}/${page}</loc><lastmod>${lastMod}</lastmod><priority>0.8</priority></url>`;
    // 尝试添加俄文版对应链接 (假设结构对称)
    xml += `\n  <url><loc>${domain}/ru/${page}</loc><lastmod>${lastMod}</lastmod><priority>0.7</priority></url>`;
  });

  // 2. 添加 Contentful 动态文章（英文）
  allEnArticles.forEach(item => {
    xml += `\n  <url><loc>${domain}${item.url}</loc><lastmod>${item.date || lastMod}</lastmod><priority>0.6</priority></url>`;
  });

  // 3. 添加 Contentful 动态文章（俄文）
  allRuArticles.forEach(item => {
    xml += `\n  <url><loc>${domain}${item.url}</loc><lastmod>${lastMod}</lastmod><priority>0.6</priority></url>`;
  });

  xml += `\n</urlset>`;
  
  // 最终写入 dist 根目录
  fs.writeFileSync('./dist/sitemap.xml', xml);
  console.log(`🚀 Sitemap.xml 已重新生成。共包含 ${staticFiles.length * 2 + allEnArticles.length + allRuArticles.length} 个链接。`);
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

  generateSitemap(allEnForSitemap, allRuForSitemap);
  console.log('所有语种及 Sitemap 生成完成！');
}

run().catch(error => {
    console.error("构建失败:", error);
    process.exit(1);
});
