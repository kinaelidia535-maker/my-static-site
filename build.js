const contentful = require('contentful');
const fs = require('fs');
const path = require('path');
const { documentToHtmlString } = require('@contentful/rich-text-html-renderer');

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

// 替换为你的实际域名，用于生成分享链接
const SITE_URL = 'https://www.mos-surfactant.com'; 

// --- 2. 工具函数 ---
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

// --- 3. 主运行函数 ---
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

  for (const locale of locales) {
    const isEn = locale === 'en-US';
    const langKey = isEn ? "en" : "ru";
    const pathPrefix = isEn ? "" : "/ru";

    console.log(`正在处理: ${locale}`);

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

    // 映射 JSON 数据
    const langData = validItems.map(item => {
      const f = item.fields;
      const catLower = f.category.trim().toLowerCase();
      const articleUrl = isEn ? `/${catLower}/${f.slug}.html` : `/ru/${catLower}/${f.slug}.html`;
      
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
      
      // 上下篇逻辑
      const nextItem = validItems[index - 1]; 
      const prevItem = validItems[index + 1];

      // 分享链接
      const pageUrl = `${SITE_URL}${isEn ? '' : '/ru'}/${catLower}/${f.slug}.html`;
      const encodedUrl = encodeURIComponent(pageUrl);
      const encodedTitle = encodeURIComponent(f.title);

      const contentHtml = documentToHtmlString(f.body);

      // 严格替换模板占位符
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

  fs.writeFileSync('./dist/data.json', JSON.stringify(allCombinedData, null, 2));
  console.log(`✅ 构建成功！有效记录: ${allCombinedData.length}`);
}

run().catch(err => {
  console.error("❌ 错误:", err);
  process.exit(1);
});
