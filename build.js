const contentful = require('contentful');
const fs = require('fs');
const path = require('path');
const { documentToHtmlString } = require('@contentful/rich-text-html-renderer');

// --- 1. 客户端配置 ---
const client = contentful.createClient({
  space: process.env.CONTENTFUL_SPACE_ID,
  accessToken: process.env.CONTENTFUL_ACCESS_TOKEN
});

const locales = ['en-US', 'ru'];

// 俄文分类显示名映射（用于详情页面包屑或标题）
const ruCategoryMap = {
    'dynamics': 'Динамика',
    'knowledge': 'Знания',
    'news': 'Новости'
};

// --- 2. 工具函数 ---

// 递归拷贝文件夹
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

// 随机图片兜底
function getRandomLocalImage() {
  const randomNum = Math.floor(Math.random() * 43) + 1;
  const paddedNum = randomNum.toString().padStart(2, '0');
  return `/imgs/article_imgs/${paddedNum}.png`;
}

// --- 3. 主运行逻辑 ---
async function run() {
  // 清理并创建 dist 目录
  if (fs.existsSync('./dist')) fs.rmSync('./dist', { recursive: true, force: true });
  fs.mkdirSync('./dist', { recursive: true });

  // 拷贝所有静态资源
  const assets = ['imgs', 'flags', 'news', 'dynamics', 'knowledge', 'products', 'ru', 'zh', 'script.js', 'styles.css', 'robots.txt', 'favicon.ico'];
  assets.forEach(asset => {
    const src = `./${asset}`;
    if (fs.existsSync(src)) {
      if (fs.lstatSync(src).isFile()) fs.copyFileSync(src, `./dist/${asset}`);
      else copyFolderSync(src, `./dist/${asset}`);
    }
  });

  // 【核心数据池】：存放所有语言的文章
  let allCombinedData = []; 

  for (const locale of locales) {
    const isEn = locale === 'en-US';
    const langKey = isEn ? "en" : "ru";
    console.log(`[${locale}] 正在处理数据...`);

    const response = await client.getEntries({ 
      content_type: 'master', 
      locale: locale, 
      order: '-sys.createdAt' 
    });
    
    if (response.items.length === 0) continue;

    // A. 加工数据，用于生成 data.json
    const processedData = response.items.map(item => {
      const fields = item.fields;
      const catLower = (fields.category || 'dynamics').trim().toLowerCase();
      
      // 根据语言生成不同的 URL 路径
      const articleUrl = isEn ? `/${catLower}/${fields.slug}.html` : `/ru/${catLower}/${fields.slug}.html`;
      
      // 图片处理
      let finalImg = getRandomLocalImage();
      const ctfImg = fields.featuredImage?.fields?.file?.url;
      if (ctfImg) finalImg = ctfImg.startsWith('//') ? 'https:' + ctfImg : ctfImg;

      return {
        title: fields.title,
        summary: fields.summary || '', 
        date: fields.datedTime,
        url: articleUrl,
        img: finalImg,
        alt: fields.imgAlt || fields.title,
        category: catLower,
        lang: langKey // 写入 lang 字段，方便前端过滤
      };
    });

    // 合并到全量池
    allCombinedData = allCombinedData.concat(processedData);

    // B. 生成物理 HTML 详情页
    const langBaseDir = isEn ? `./dist` : `./dist/ru`;
    const templatePath = isEn ? `./template.html` : `./template_ru.html`;
    const templateContent = fs.readFileSync(fs.existsSync(templatePath) ? templatePath : './template.html', 'utf8');

    response.items.forEach(item => {
      const f = item.fields;
      const catLower = f.category.trim().toLowerCase();
      const outDir = path.join(langBaseDir, catLower);
      if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

      const contentHtml = documentToHtmlString(f.body);
      const html = templateContent
        .replace(/{{TITLE}}/g, f.title)
        .replace(/{{CONTENT}}/g, contentHtml)
        .replace(/{{DATE}}/g, f.datedTime);

      fs.writeFileSync(path.join(outDir, `${f.slug}.html`), html);
    });
  }

  // C. 【关键输出】：在根目录生成唯一的全量 JSON 文件
  fs.writeFileSync('./dist/data.json', JSON.stringify(allCombinedData, null, 2));
  console.log(`✅ 成功！全量 data.json 已生成，共 ${allCombinedData.length} 条记录。`);
}

run().catch(err => {
  console.error("❌ 构建过程中出错:", err);
  process.exit(1);
});
