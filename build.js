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
  // 初始化 dist
  if (fs.existsSync('./dist')) fs.rmSync('./dist', { recursive: true, force: true });
  fs.mkdirSync('./dist', { recursive: true });

  // 拷贝资源
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
    console.log(`正在处理语言分支: ${locale}`);

    const response = await client.getEntries({ 
      content_type: 'master', 
      locale: locale, 
      order: '-sys.createdAt' 
    });
    
    if (response.items.length === 0) continue;

    const langBaseDir = isEn ? `./dist` : `./dist/ru`;
    if (!fs.existsSync(langBaseDir)) fs.mkdirSync(langBaseDir, { recursive: true });

    // --- 修正点：JSON 数据生成 ---
    const langData = response.items.map(item => {
      const f = item.fields;

      // 【核心修正 A】：防止语言回退污染
      // 检查条目自带的 lang 标签是否与当前处理的 locale 匹配
      // 如果条目里标的是 'en'，但我们现在在处理 'ru' 循环，直接剔除
      if (f.lang !== langKey) return null;

      if (!f.title || !f.slug) return null;

      const catLower = (f.category || 'dynamics').trim().toLowerCase();
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
    }).filter(Boolean); 

    allCombinedData = allCombinedData.concat(langData);

    // --- 修正点：物理 HTML 生成 ---
    const templatePath = isEn ? `./template.html` : `./template_ru.html`;
    const templateContent = fs.readFileSync(fs.existsSync(templatePath) ? templatePath : './template.html', 'utf8');

    response.items.forEach(item => {
      const f = item.fields;
      
      // 【核心修正 B】：同步 HTML 生成的语言过滤
      if (f.lang !== langKey) return;
      if (!f.title || !f.category || !f.slug) return;

      const catLower = f.category.trim().toLowerCase();
      const outDir = path.join(langBaseDir, catLower);
      if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

      const contentHtml = documentToHtmlString(f.body);
      const html = templateContent
        .replace(/{{TITLE}}/g, f.title)
        .replace(/{{CONTENT}}/g, contentHtml)
        .replace(/{{DATE}}/g, f.datedTime)
        .replace(/{{CATEGORY_UPPER}}/g, isEn ? catLower.toUpperCase() : (ruCategoryMap[catLower] || catLower).toUpperCase());

      fs.writeFileSync(path.join(outDir, `${f.slug}.html`), html);
    });
  }

  fs.writeFileSync('./dist/data.json', JSON.stringify(allCombinedData, null, 2));
  console.log(`✅ 构建成功！已通过严格语言校验，有效记录：${allCombinedData.length} 条。`);
}

run().catch(err => {
  console.error("❌ 错误:", err);
  process.exit(1);
});
