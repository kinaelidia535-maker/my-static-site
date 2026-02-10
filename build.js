const contentful = require('contentful');
const fs = require('fs');
const path = require('path');
const { documentToHtmlString } = require('@contentful/rich-text-html-renderer');
const { BLOCKS } = require('@contentful/rich-text-types'); 

// --- 1. 配置 ---
const client = contentful.createClient({
  space: process.env.CONTENTFUL_SPACE_ID,
  accessToken: process.env.CONTENTFUL_ACCESS_TOKEN
});

const locales = ['en-US', 'ru'];

const ruCategoryMap = {
    'dynamics': 'Динамика',
    'knowledge': 'Знания',
    'news': 'Новости'
};

const SITE_URL = 'https://www.mos-surfactant.com'; 

// --- 2. 富文本渲染配置 ---
const renderOptions = {
  renderNode: {
    [BLOCKS.EMBEDDED_ASSET]: (node) => {
      const { file, title } = node.data.target.fields;
      if (!file) return '';
      const imageUrl = file.url.startsWith('//') ? `https:${file.url}` : file.url;
      return `
        <div class="rich-text-image">
          <img src="${imageUrl}" alt="${title || 'article image'}" loading="lazy" />
          ${title ? `<p class="image-caption">${title}</p>` : ''}
        </div>`;
    },
    [BLOCKS.TABLE]: (node, next) => `<div class="table-container"><table>${next(node.content)}</table></div>`,
    [BLOCKS.TABLE_HEADER_CELL]: (node, next) => `<th>${next(node.content)}</th>`,
    [BLOCKS.TABLE_CELL]: (node, next) => `<td>${next(node.content)}</td>`
  }
};

// --- 3. 工具函数 ---
function copyFolderSync(from, to) {
  if (!fs.existsSync(from)) return;
  if (!fs.existsSync(to)) fs.mkdirSync(to, { recursive: true });
  fs.readdirSync(from).forEach(element => {
    const fromPath = path.join(from, element);
    const toPath = path.join(to, element);
    if (fs.lstatSync(fromPath).isFile()) {
      fs.copyFileSync(fromPath, toPath);
    } else {
      copyFolderSync(fromPath, toPath);
    }
  });
}

function getRandomLocalImage() {
  const randomNum = Math.floor(Math.random() * 43) + 1;
  const paddedNum = randomNum.toString().padStart(2, '0');
  return `/imgs/article_imgs/${paddedNum}.png`;
}

// --- 4. 主运行函数 ---
async function run() {
  if (fs.existsSync('./dist')) fs.rmSync('./dist', { recursive: true, force: true });
  fs.mkdirSync('./dist', { recursive: true });

  const assets = ['imgs', 'flags', 'news', 'dynamics', 'knowledge', 'products', 'ru', 'zh', 'script.js', 'styles.css', 'robots.txt', 'favicon.ico'];
  assets.forEach(asset => {
    const src = `./${asset}`;
    if (fs.existsSync(src)) {
      if (fs.lstatSync(src).isFile()) fs.copyFileSync(src, `./dist/${asset}`);
      else copyFolderSync(src, `./dist/${asset}`);
    }
  });

  let allCombinedData = [];
  let newSitemapEntries = ""; 
  const today = new Date().toISOString().split('T')[0];

  for (const locale of locales) {
    const isEn = locale === 'en-US';
    const langKey = isEn ? "en" : "ru";

    console.log(`正在处理语言: ${locale}`);

    const response = await client.getEntries({ 
      content_type: 'master', 
      locale: locale,
      order: '-fields.datedTime' 
    });
    
    const validItems = response.items.filter(item => {
      const f = item.fields;
      return f.title && f.slug && f.category && f.body;
    });

    const langBaseDir = isEn ? `./dist` : `./dist/ru`;
    if (!fs.existsSync(langBaseDir)) fs.mkdirSync(langBaseDir, { recursive: true });

    // 1. 先生成 data.json 需要的数据和 Sitemap 条目
    const langData = validItems.map(item => {
      const f = item.fields;
      const catLower = f.category.trim().toLowerCase();
      const articleUrl = isEn ? `/${catLower}/${f.slug}.html` : `/ru/${catLower}/${f.slug}.html`;
      
      newSitemapEntries += `  <url>\n    <loc>${SITE_URL}${articleUrl}</loc>\n    <lastmod>${today}</lastmod>\n    <priority>0.80</priority>\n  </url>\n`;

      let finalImg = "";
      const ctfImg = f.featuredImage?.fields?.file?.url;
      if (ctfImg) {
        finalImg = ctfImg.startsWith('//') ? 'https:' + ctfImg : ctfImg;
      } else {
        finalImg = getRandomLocalImage();
      }

      return {
        title: f.title,
        summary: f.summary || '', 
        date: f.datedTime,
        url: articleUrl,
        img: finalImg,
        alt: f.imgAlt || f.title,
        category: catLower,
        lang: langKey
      };
    });
    allCombinedData = allCombinedData.concat(langData);

    // 2. 关键修改：按分类对文章进行分组，确保上下页导航在同一分类内
    const categories = ['news', 'dynamics', 'knowledge'];
    const templatePath = isEn ? `./template.html` : `./template_ru.html`;
    const templateContent = fs.readFileSync(fs.existsSync(templatePath) ? templatePath : './template.html', 'utf8');

    categories.forEach(cat => {
      // 过滤出当前分类的文章
      const categoryItems = validItems.filter(item => item.fields.category.trim().toLowerCase() === cat);

      categoryItems.forEach((item, index) => {
        const f = item.fields;
        const catLower = cat;
        
        // 只在当前分类的文章列表中找上一篇和下一篇
        // 注意：API order 是日期倒序，所以 index-1 是“更新的/下一篇”，index+1 是“更旧的/上一篇”
        const nextItem = categoryItems[index - 1]; 
        const prevItem = categoryItems[index + 1];

        const pageUrl = `${SITE_URL}${isEn ? '' : '/ru'}/${catLower}/${f.slug}.html`;
        const encodedUrl = encodeURIComponent(pageUrl);
        const encodedTitle = encodeURIComponent(f.title);
        const contentHtml = documentToHtmlString(f.body, renderOptions);

        let html = templateContent
          .replace(/{{TITLE}}/g, f.title)
          .replace(/{{CONTENT}}/g, contentHtml)
          .replace(/{{DATE}}/g, f.datedTime)
          .replace(/{{CATEGORY}}/g, f.category)
          .replace(/{{CATEGORY_LOWER}}/g, catLower)
          .replace(/{{CATEGORY_UPPER}}/g, isEn ? catLower.toUpperCase() : (ruCategoryMap[catLower] || catLower).toUpperCase())
          .replace(/{{SLUG}}/g, f.slug)
          .replace(/{{PREV_LINK}}/g, prevItem ? `${prevItem.fields.slug}.html` : '#')
          .replace(/{{PREV_TITLE}}/g, prevItem ? prevItem.fields.title : (isEn ? 'No more' : 'Больше нет'))
          .replace(/{{NEXT_LINK}}/g, nextItem ? `${nextItem.fields.slug}.html` : '#')
          .replace(/{{NEXT_TITLE}}/g, nextItem ? nextItem.fields.title : (isEn ? 'No more' : 'Больше нет'))
          .replace(/{{LINKEDIN_SHARE}}/g, `https://www.linkedin.com/sharing/share-offsite/?url=${encodedUrl}`)
          .replace(/{{FACEBOOK_SHARE}}/g, `https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}`)
          .replace(/{{WHATSAPP_SHARE}}/g, `https://api.whatsapp.com/send?text=${encodedTitle}%20${encodedUrl}`);

        const outDir = path.join(langBaseDir, catLower);
        if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
        fs.writeFileSync(path.join(outDir, `${f.slug}.html`), html);
      });
    });
  }

// --- Sitemap 处理 (自动去重优化版) ---
  const sitemapTemplatePath = './sitemap1.xml';
  if (fs.existsSync(sitemapTemplatePath)) {
    let sitemapContent = fs.readFileSync(sitemapTemplatePath, 'utf8');

    // 1. 提取文件中现有的所有 <url> 块
    const urlRegex = /<url>[\s\S]*?<\/url>/g;
    const existingUrls = sitemapContent.match(urlRegex) || [];

    // 2. 将新生成的条目转为数组
    // 注意：我们将 newSitemapEntries 拆分为单条，方便后续对比
    const newEntriesArray = newSitemapEntries.trim().split('</url>').filter(i => i.includes('<url>')).map(i => i + '</url>');

    // 3. 合并新旧内容，并以 <loc> 标签内容作为唯一 Key 进行去重
    // 使用 Map 可以确保：如果 URL 重复，保留最新的版本（newEntries 放在后面覆盖旧的）
    const allUrlsMap = new Map();

    // 先放旧的
    existingUrls.forEach(entry => {
      const locMatch = entry.match(/<loc>(.*?)<\/loc>/);
      if (locMatch) allUrlsMap.set(locMatch[1], entry);
    });

    // 后放新的，如果有重复的 URL，新的会替换掉旧的（日期也会更新）
    newEntriesArray.forEach(entry => {
      const locMatch = entry.match(/<loc>(.*?)<\/loc>/);
      if (locMatch) allUrlsMap.set(locMatch[1], entry);
    });

    // 4. 重新构建 Sitemap 内容
    const cleanUrlList = Array.from(allUrlsMap.values()).join('\n');

    // 5. 组合最终的 XML
    const finalSitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${cleanUrlList}
</urlset>`;

    // 6. 写入到输出目录和备份文件
    fs.writeFileSync('./dist/sitemap.xml', finalSitemap);
    fs.writeFileSync('./sitemap1.xml', finalSitemap); 
    
    console.log(`✅ Sitemap 已自动清理去重。当前总条目数: ${allUrlsMap.size}`);
  }
