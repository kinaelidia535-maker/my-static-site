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

    // 🔥 关键：只获取当前语言的数据，fallback已禁用
    const response = await client.getEntries({ 
      content_type: 'master', 
      locale: locale,  // 指定当前语言
      order: '-sys.createdAt' 
    });
    
    console.log(`  ${locale}: 获取到 ${response.items.length} 条原始数据`);

    const langBaseDir = isEn ? `./dist` : `./dist/ru`;
    if (!fs.existsSync(langBaseDir)) fs.mkdirSync(langBaseDir, { recursive: true });

    // 🔥 过滤掉没有必要字段的条目（fallback禁用后，没内容的条目这些字段会是 undefined）
    const validItems = response.items.filter(item => {
      const f = item.fields;
      // 必须有这些核心字段才算有效
      return f.title && f.slug && f.category && f.body;
    });

    console.log(`  ${locale}: ${validItems.length} 条有效数据（已过滤空条目）`);

    // 生成 JSON 数据
    const langData = validItems.map(item => {
      const f = item.fields;
      const catLower = f.category.trim().toLowerCase();
      const articleUrl = isEn ? `/${catLower}/${f.slug}.html` : `/ru/${catLower}/${f.slug}.html`;
      
      // 图片逻辑
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

    // 生成 HTML 文件
    const templatePath = isEn ? `./template.html` : `./template_ru.html`;
    const templateContent = fs.readFileSync(fs.existsSync(templatePath) ? templatePath : './template.html', 'utf8');

    validItems.forEach(item => {
      const f = item.fields;
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

  // 生成统一的 data.json
  fs.writeFileSync('./dist/data.json', JSON.stringify(allCombinedData, null, 2));
  console.log(`✅ 构建成功！全量 data.json 包含 ${allCombinedData.length} 条有效记录。`);
}

run().catch(err => {
  console.error("❌ 错误:", err);
  process.exit(1);
});
