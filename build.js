const contentful = require('contentful');
const fs = require('fs');
const path = require('path');
const { documentToHtmlString } = require('@contentful/rich-text-html-renderer');
const { BLOCKS } = require('@contentful/rich-text-types'); // 必须引入，用于处理图片和表格

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

// --- 2. 富文本渲染配置 (核心修复点) ---
const renderOptions = {
  renderNode: {
    // 渲染富文本中的图片
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
    // 确保表格正常渲染（虽然默认会渲染 table 标签，但显式定义更安全）
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

    console.log(`正在处理: ${locale}`);

    const response = await client.getEntries({ 
      content_type: 'master', 
      locale: locale,
      order: '-fields.datedTime' 
    });
    
    // 过滤掉残缺数据（排除 undefined.html 的元凶）
    const validItems = response.items.filter(item => {
      const f = item.fields;
      return f.title && f.slug && f.category && f.body;
    });

    const langBaseDir = isEn ? `./dist` : `./dist/ru`;
    if (!fs.existsSync(langBaseDir)) fs.mkdirSync(langBaseDir, { recursive: true });

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

    const templatePath = isEn ? `./template.html` : `./template_ru.html`;
    const templateContent = fs.readFileSync(fs.existsSync(templatePath) ? templatePath : './template.html', 'utf8');

    validItems.forEach((item, index) => {
      const f = item.fields;
      const catLower = f.category.trim().toLowerCase();
      const nextItem = validItems[index - 1]; 
      const prevItem = validItems[index + 1];

      const pageUrl = `${SITE_URL}${isEn ? '' : '/ru'}/${catLower}/${f.slug}.html`;
      const encodedUrl = encodeURIComponent(pageUrl);
      const encodedTitle = encodeURIComponent(f.title);

      // 使用配置好的 renderOptions 解析富文本（解决图片和表格）
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
        .replace(/{{PREV_TITLE}}/g, prevItem ? prevItem.fields.title : 'None')
        .replace(/{{NEXT_LINK}}/g, nextItem ? `${nextItem.fields.slug}.html` : '#')
        .replace(/{{NEXT_TITLE}}/g, nextItem ? nextItem.fields.title : 'None')
        .replace(/{{LINKEDIN_SHARE}}/g, `https://www.linkedin.com/sharing/share-offsite/?url=${encodedUrl}`)
        .replace(/{{FACEBOOK_SHARE}}/g, `https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}`)
        .replace(/{{WHATSAPP_SHARE}}/g, `https://api.whatsapp.com/send?text=${encodedTitle}%20${encodedUrl}`);

      const outDir = path.join(langBaseDir, catLower);
      if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
      fs.writeFileSync(path.join(outDir, `${f.slug}.html`), html);
    });
  }

  // --- Sitemap 处理 (保持你的逻辑) ---
  const sitemapTemplatePath = './sitemap1.xml';
  if (fs.existsSync(sitemapTemplatePath)) {
    let sitemapContent = fs.readFileSync(sitemapTemplatePath, 'utf8');
    const urlsetMatch = sitemapContent.match(/<urlset[^>]*>/);
    if (urlsetMatch) {
      const insertPosition = urlsetMatch.index + urlsetMatch[0].length;
      const updatedSitemap = sitemapContent.slice(0, insertPosition) + "\n" + newSitemapEntries + sitemapContent.slice(insertPosition);
      fs.writeFileSync('./dist/sitemap.xml', updatedSitemap);
      fs.writeFileSync('./sitemap1.xml', updatedSitemap); 
      console.log(`✅ Sitemap 已更新。`);
    }
  }

  fs.writeFileSync('./dist/data.json', JSON.stringify(allCombinedData, null, 2));
  console.log(`✅ 构建成功！有效记录: ${allCombinedData.length}`);
}

run().catch(err => {
  console.error("❌ 错误:", err);
  process.exit(1);
});
