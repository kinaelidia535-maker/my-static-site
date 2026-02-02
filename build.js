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

  // 2. 拷贝静态资源
  const foldersToCopy = ['imgs', 'flags', 'news', 'dynamics', 'knowledge', 'products', 'ru', 'zh'];
  foldersToCopy.forEach(folder => {
    if (fs.existsSync(`./${folder}`)) copyFolderSync(`./${folder}`, `./dist/${folder}`);
  });
  
  const filesToCopy = ['script.js', 'styles.css', 'robots.txt', 'favicon.ico', 'sitemap1.xml'];
  filesToCopy.forEach(file => {
    if (fs.existsSync(`./${file}`)) fs.copyFileSync(`./${file}`, `./dist/${file}`);
  });

  let allCombinedData = []; 

  // 3. 从 Contentful 获取数据 (使用 withAllLocales 模式)
  console.log(`正在从 Contentful 获取全量语言数据...`);
  const response = await client.withAllLocales.getEntries({ 
    content_type: 'master', 
    order: '-sys.createdAt' 
  });

  for (const locale of locales) {
    const isEn = locale === 'en-US';
    const langKey = isEn ? "en" : "ru";
    console.log(`--- 正在处理语言分支: ${locale} (标记为: ${langKey}) ---`);
    
    // 【优化过滤逻辑】
    const validEntries = response.items.filter(item => {
        // 检查该语言下标题是否存在
        const hasTitle = item.fields && item.fields.title && item.fields.title[locale];
        if (!hasTitle) console.log(`⚠️ 跳过条目 [${item.sys.id}]: 缺失 ${locale} 版本的标题`);
        return hasTitle;
    }).map(item => {
        const flattenedFields = {};
        // 扁平化所有基础字段
        Object.keys(item.fields).forEach(key => {
            // 如果当前语言没有值，尝试回退到 en-US
            flattenedFields[key] = item.fields[key][locale] || item.fields[key]['en-US'] || '';
        });

        // 【核心修正】：处理 withAllLocales 下复杂的图片结构
        let finalImg = getRandomLocalImage();
        try {
            const imgAsset = item.fields.featuredImage ? item.fields.featuredImage[locale] : null;
            // 在 withAllLocales 下，Asset 内部的 fields 也是带 locale 键的
            const imgUrl = imgAsset?.fields?.file[locale]?.url || imgAsset?.fields?.file['en-US']?.url;
            if (imgUrl) {
                finalImg = imgUrl.startsWith('//') ? 'https:' + imgUrl : imgUrl;
            }
        } catch (e) {
            console.log(`🖼️ 图片解析失败 [${item.sys.id}], 使用随机图`);
        }

        return { ...item, flattenedFields, finalImg };
    });

    // 构建 data.json 用的结构
    const langData = validEntries.map(item => {
      const f = item.flattenedFields;
      const catLower = (f.category || 'dynamics').trim().toLowerCase();
      
      // 生成正确的物理 URL
      const articleUrl = isEn ? `/${catLower}/${f.slug}.html` : `/ru/${catLower}/${f.slug}.html`;

      return {
        title: f.title,
        summary: f.summary || '', 
        date: f.datedTime,
        url: articleUrl,
        img: item.finalImg,
        alt: f.imgAlt || f.title,
        category: catLower,
        lang: langKey // 确保写入对应的语言标记
      };
    });

    allCombinedData = allCombinedData.concat(langData);

    // 4. 生成详情页 HTML
    const langBaseDir = isEn ? `./dist` : `./dist/ru`;
    if (!fs.existsSync(langBaseDir)) fs.mkdirSync(langBaseDir, { recursive: true });
    
    const templatePath = isEn ? `./template.html` : `./template_ru.html`;
    const templateContent = fs.readFileSync(fs.existsSync(templatePath) ? templatePath : './template.html', 'utf8');

    validEntries.forEach(item => {
        const { title, body, slug, datedTime, category } = item.flattenedFields;
        const catLower = category.trim().toLowerCase();
        const outDir = path.join(langBaseDir, catLower);
        if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
        
        // 渲染富文本内容
        const contentHtml = documentToHtmlString(body);
        const html = templateContent
            .replace(/{{TITLE}}/g, title)
            .replace(/{{CONTENT}}/g, contentHtml)
            .replace(/{{DATE}}/g, datedTime);
            
        fs.writeFileSync(path.join(outDir, `${slug}.html`), html);
    });
  }

  // 5. 生成唯一的全量 data.json
  fs.writeFileSync('./dist/data.json', JSON.stringify(allCombinedData, null, 2));
  console.log(`✅ 构建完成！data.json 共包含 ${allCombinedData.length} 条记录。`);
}

run().catch(error => {
    console.error("❌ 致命错误:", error);
    process.exit(1);
});
