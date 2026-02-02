const contentful = require('contentful');
const fs = require('fs');
const path = require('path');
const { documentToHtmlString } = require('@contentful/rich-text-html-renderer');

// --- 客户端配置 ---
const client = contentful.createClient({
  space: process.env.CONTENTFUL_SPACE_ID,
  accessToken: process.env.CONTENTFUL_ACCESS_TOKEN
});

const locales = ['en-US', 'ru'];

// --- 俄文分类翻译表 ---
const ruCategoryMap = {
    'dynamics': 'Динамика',
    'knowledge': 'Знания',
    'news': 'Новости'
};

// --- 工具函数：文件夹递归拷贝 ---
function copyFolderSync(from, to) {
  if (!fs.existsSync(from)) return;
  if (!fs.existsSync(to)) fs.mkdirSync(to, { recursive: true });
  fs.readdirSync(from).forEach(element => {
    if (fs.lstatSync(path.join(from, element)).isFile()) {
      fs.copyFileSync(path.join(from, element), path.join(to, element));
    } else {
      copyFolderSync(path.join(from, element), path.join(to, element));
    }
  });
}

function getRandomLocalImage() {
  const randomNum = Math.floor(Math.random() * 43) + 1;
  const paddedNum = randomNum.toString().padStart(2, '0');
  return `/imgs/article_imgs/${paddedNum}.png`;
}

// --- 主运行函数 ---
async function run() {
  // 1. 初始化 dist 目录
  if (fs.existsSync('./dist')) fs.rmSync('./dist', { recursive: true, force: true });
  fs.mkdirSync('./dist', { recursive: true });

  // 2. 拷贝所有静态资源
  const foldersToCopy = ['imgs', 'flags', 'news', 'dynamics', 'knowledge', 'products', 'ru', 'zh'];
  foldersToCopy.forEach(folder => {
    if (fs.existsSync(`./${folder}`)) copyFolderSync(`./${folder}`, `./dist/${folder}`);
  });
  
  const filesToCopy = ['script.js', 'styles.css', 'robots.txt', 'favicon.ico', 'sitemap1.xml'];
  filesToCopy.forEach(file => {
    if (fs.existsSync(`./${file}`)) fs.copyFileSync(`./${file}`, `./dist/${file}`);
  });

  let allCombinedData = []; // 用于存放所有语言的合并数据
  let totalArticlesForSitemap = [];

  // 3. 从 Contentful 获取数据
  console.log(`正在从 Contentful 获取全量语言数据...`);
  const response = await client.withAllLocales.getEntries({ 
    content_type: 'master', 
    order: '-sys.createdAt' 
  });

  for (const locale of locales) {
    const isEn = locale === 'en-US';
    const langKey = isEn ? "en" : "ru";
    
    const validEntries = response.items.filter(item => {
        return item.fields && item.fields.title && item.fields.title[locale];
    }).map(item => {
        const flattenedFields = {};
        Object.keys(item.fields).forEach(key => {
            flattenedFields[key] = item.fields[key][locale] || '';
        });
        const featuredImage = item.fields.featuredImage ? item.fields.featuredImage[locale] : null;
        return { ...item, fields: flattenedFields, featuredImageRaw: featuredImage };
    });

    if (validEntries.length === 0) continue;

    // 构建数据并加入 lang 字段
    const langData = validEntries.map(item => {
      const catLower = (item.fields.category || 'dynamics').trim().toLowerCase();
      const articleUrl = isEn ? `/${catLower}/${item.fields.slug}.html` : `/ru/${catLower}/${item.fields.slug}.html`;
      
      let finalImg = '';
      const ctfImg = item.featuredImageRaw?.fields?.file?.url;
      finalImg = ctfImg ? (ctfImg.startsWith('//') ? 'https:' + ctfImg : ctfImg) : getRandomLocalImage();

      return {
        title: item.fields.title,
        summary: item.fields.summary || '', 
        date: item.fields.datedTime,
        url: articleUrl,
        img: finalImg,
        alt: item.fields.imgAlt || item.fields.title,
        category: catLower,
        lang: langKey // --- 新增语言字段 ---
      };
    });

    allCombinedData = allCombinedData.concat(langData);
    totalArticlesForSitemap = totalArticlesForSitemap.concat(langData);

    // 生成详情页 HTML (详情页依然保持物理隔离在 /ru/ 下)
    const langBaseDir = isEn ? `./dist` : `./dist/ru`;
    if (!fs.existsSync(langBaseDir)) fs.mkdirSync(langBaseDir, { recursive: true });
    
    const templatePath = isEn ? `./template.html` : `./template_ru.html`;
    const templateContent = fs.readFileSync(fs.existsSync(templatePath) ? templatePath : './template.html', 'utf8');

    validEntries.forEach(item => {
        const { title, body, slug, datedTime, category } = item.fields;
        const catLower = category.trim().toLowerCase();
        const outDir = path.join(langBaseDir, catLower);
        if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
        
        const contentHtml = documentToHtmlString(body);
        const html = templateContent.replace(/{{TITLE}}/g, title).replace(/{{CONTENT}}/g, contentHtml).replace(/{{DATE}}/g, datedTime);
        fs.writeFileSync(path.join(outDir, `${slug}.html`), html);
    });
  }

  // 4. 【核心改动】：在根目录生成唯一的全量 data.json
  fs.writeFileSync('./dist/data.json', JSON.stringify(allCombinedData, null, 2));
  console.log(`✅ 全量 data.json 已生成，共包含 ${allCombinedData.length} 条多语言数据。`);

  // Sitemap 更新逻辑...
  console.log('🚀 构建流程完美结束！');
}

run().catch(error => {
    console.error("❌ 错误:", error);
    process.exit(1);
});
