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

  let allCombinedData = []; // 用于生成根目录的总 data.json

  for (const locale of locales) {
    const isEn = locale === 'en-US';
    const langKey = isEn ? "en" : "ru";
    console.log(`正在处理语言分支: ${locale}`);

    // 获取当前语言的数据
    const response = await client.getEntries({ 
      content_type: 'master', 
      locale: locale, 
      order: '-sys.createdAt' 
    });
    
    if (response.items.length === 0) continue;

    const langBaseDir = isEn ? `./dist` : `./dist/ru`;
    if (!fs.existsSync(langBaseDir)) fs.mkdirSync(langBaseDir, { recursive: true });

    // --- 修正 A：处理数据用于 JSON，并过滤掉无效条目 ---
    const langData = response.items.map(item => {
      const f = item.fields;

      // 如果没有标题或没有 slug，说明是该语言下的空条目（幽灵数据），直接跳过
      if (!f.title || !f.slug) return null;

      const catLower = (f.category || 'dynamics').trim().toLowerCase();
      // 这里的 URL 必须带 /ru/ 前缀给俄语
      const articleUrl = isEn ? `/${catLower}/${f.slug}.html` : `/ru/${catLower}/${f.slug}.html`;
      
      // 修正图片逻辑：优先取上传的图，没有才随机
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
    }).filter(Boolean); // 剔除 null 条目

    allCombinedData = allCombinedData.concat(langData);

    // --- 修正 B：生成物理 HTML 文件时增加校验 ---
    const templatePath = isEn ? `./template.html` : `./template_ru.html`;
    const templateContent = fs.readFileSync(fs.existsSync(templatePath) ? templatePath : './template.html', 'utf8');

    response.items.forEach(item => {
      const f = item.fields;
      
      // 只有标题和分类都存在的有效内容才生成 HTML
      if (!f.title || !f.category || !f.slug) return;

      const catLower = f.category.trim().toLowerCase();
      
      // 确保文件夹路径正确
      const outDir = path.join(langBaseDir, catLower);
      if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

      const contentHtml = documentToHtmlString(f.body);
      const html = templateContent
        .replace(/{{TITLE}}/g, f.title)
        .replace(/{{CONTENT}}/g, contentHtml)
        .replace(/{{DATE}}/g, f.datedTime)
        .replace(/{{CATEGORY_UPPER}}/g, isEn ? catLower.toUpperCase() : (ruCategoryMap[catLower] || catLower).toUpperCase());

      // 写入文件
      fs.writeFileSync(path.join(outDir, `${f.slug}.html`), html);
    });
  }

  // 生成统一的 data.json
  fs.writeFileSync('./dist/data.json', JSON.stringify(allCombinedData, null, 2));
  console.log(`✅ 构建成功！全量 data.json 已清洗，包含 ${allCombinedData.length} 条有效记录。`);
}

run().catch(err => {
  console.error("❌ 错误:", err);
  process.exit(1);
});
