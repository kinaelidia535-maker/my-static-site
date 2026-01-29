const contentful = require('contentful');
const fs = require('fs');
const path = require('path');
const { documentToHtmlString } = require('@contentful/rich-text-html-renderer');

const client = contentful.createClient({
  space: process.env.CONTENTFUL_SPACE_ID,
  accessToken: process.env.CONTENTFUL_ACCESS_TOKEN
});

const locales = ['en-US', 'ru'];

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

// --- 工具函数：随机获取本地图片 (01-43.png) ---
function getRandomLocalImage() {
  const randomNum = Math.floor(Math.random() * 43) + 1;
  const paddedNum = randomNum.toString().padStart(2, '0');
  // 使用绝对路径，防止子目录引用失效
  return `/imgs/article_imgs/${paddedNum}.png`;
}

// --- 工具函数：深度递归扫描 HTML (修正版) ---
function getAllHtmlFiles(dirPath, arrayOfFiles) {
  const files = fs.readdirSync(dirPath);
  arrayOfFiles = arrayOfFiles || [];

  files.forEach(function(file) {
    const fullPath = path.join(dirPath, file);
    // 排除构建输出目录和依赖目录
    if (file === 'dist' || file === 'node_modules' || file === '.git') return;

    if (fs.statSync(fullPath).isDirectory()) {
      arrayOfFiles = getAllHtmlFiles(fullPath, arrayOfFiles);
    } else {
      // 匹配 HTML 文件，排除模板文件
      if (file.endsWith(".html") && !file.startsWith('template')) {
        let urlPath = fullPath.replace(/\\/g, '/').replace(/^\./, '');
        if (!urlPath.startsWith('/')) urlPath = '/' + urlPath;
        arrayOfFiles.push(urlPath);
      }
    }
  });
  return arrayOfFiles;
}

// --- 工具函数：生成 Sitemap (带去重) ---
function generateSitemap(allEnArticles, allRuArticles) {
  const domain = 'https://www.mos-surfactant.com';
  const lastMod = new Date().toISOString().split('T')[0];
  const urlSet = new Set();

  // 1. 添加所有静态页面 (根目录、ru、zh 等)
  const staticUrls = getAllHtmlFiles('./');
  staticUrls.forEach(url => urlSet.add(url));

  // 2. 添加 Contentful 动态生成的页面
  [...allEnArticles, ...allRuArticles].forEach(item => {
    urlSet.add(item.url);
  });

  let xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`;
  urlSet.forEach(url => {
    const priority = (url === '/index.html' || url === '/') ? '1.0' : '0.8';
    xml += `\n  <url>\n    <loc>${domain}${url}</loc>\n    <lastmod>${lastMod}</lastmod>\n    <priority>${priority}</priority>\n  </url>`;
  });
  xml += `\n</urlset>`;
  
  fs.writeFileSync('./dist/sitemap.xml', xml);
  console.log(`✅ Sitemap 更新完成，共 ${urlSet.size} 个唯一页面。`);
}

// --- 主运行函数 ---
async function run() {
  if (!fs.existsSync('./dist')) fs.mkdirSync('./dist', { recursive: true });

  // [重要] 构建前同步基础静态资源到 dist
  const foldersToCopy = ['imgs', 'flags', 'news', 'dynamics', 'knowledge', 'products', 'ru', 'zh'];
  foldersToCopy.forEach(folder => {
    if (fs.existsSync(`./${folder}`)) copyFolderSync(`./${folder}`, `./dist/${folder}`);
  });
  
  // 拷贝根目录下的基础文件
  const filesToCopy = ['script.js', 'styles.css', 'robots.txt', 'favicon.ico'];
  filesToCopy.forEach(file => {
    if (fs.existsSync(`./${file}`)) fs.copyFileSync(`./${file}`, `./dist/${file}`);
  });

  let allEnForSitemap = [];
  let allRuForSitemap = [];

  for (const locale of locales) {
    const isEn = locale === 'en-US';
    console.log(`正在从 Contentful 抓取 [${locale}] 数据...`);

    const response = await client.getEntries({ 
      content_type: 'master', 
      locale: locale, 
      order: '-sys.createdAt' 
    });
    
    const allEntries = response.items;
    if (allEntries.length === 0) continue;

    const langBaseDir = isEn ? `./dist` : `./dist/ru`;
    if (!fs.existsSync(langBaseDir)) fs.mkdirSync(langBaseDir, { recursive: true });

    // 1. 生成 data.json
    const indexData = allEntries.map(item => {
      const cat = (item.fields.category || 'dynamics').toLowerCase().trim();
      const articleUrl = isEn ? `/${cat}/${item.fields.slug}.html` : `/ru/${cat}/${item.fields.slug}.html`;
      
      let finalImg = '';
      const ctfImg = item.fields.featuredImage?.fields?.file?.url;
      if (ctfImg) {
        finalImg = ctfImg.startsWith('//') ? 'https:' + ctfImg : ctfImg;
      } else {
        finalImg = getRandomLocalImage();
      }

      return {
        title: item.fields.title,
        summary: item.fields.summary || '', 
        date: item.fields.datedTime,
        url: articleUrl,
        img: finalImg,
        alt: item.fields.imgAlt || item.fields.title,
        category: cat
      };
    });
    fs.writeFileSync(`${langBaseDir}/data.json`, JSON.stringify(indexData));

    if (isEn) allEnForSitemap = indexData;
    else allRuForSitemap = indexData;

    // 2. 生成详情页 HTML
    const templatePath = isEn ? `./template.html` : `./template_ru.html`;
    const templateContent = fs.readFileSync(fs.existsSync(templatePath) ? templatePath : './template.html', 'utf8');

    const groups = {};
    allEntries.forEach(item => {
      const cat = (item.fields.category || 'dynamics').toLowerCase().trim();
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(item);
    });

    for (const [catName, items] of Object.entries(groups)) {
      items.forEach((item, i) => {
        const { title, body, slug, datedTime, imgAlt } = item.fields;
        const currentAlt = imgAlt || title; 
        const contentHtml = documentToHtmlString(body);
        const domain = "https://www.mos-surfactant.com";
        const sharePath = isEn ? `/${catName}/${slug}.html` : `/ru/${catName}/${slug}.html`;
        const pageUrl = encodeURIComponent(`${domain}${sharePath}`);

        let html = templateContent
          .replace(/{{TITLE}}/g, title)
          .replace(/{{CONTENT}}/g, contentHtml)
          .replace(/{{DATE}}/g, datedTime)
          .replace(/{{SLUG}}/g, slug)
          .replace(/{{IMG_ALT}}/g, currentAlt)
          .replace(/{{CATEGORY}}/g, catName)
          .replace(/{{ARTICLE_PATH}}/g, sharePath)
          .replace(/{{LINKEDIN_SHARE}}/g, `https://www.linkedin.com/sharing/share-offsite/?url=${pageUrl}`)
          .replace(/{{FACEBOOK_SHARE}}/g, `https://www.facebook.com/sharer/sharer.php?u=${pageUrl}`)
          .replace(/{{WHATSAPP_SHARE}}/g, `https://api.whatsapp.com/send?text=${encodeURIComponent(title)}%20${pageUrl}`)
          .replace(/{{TWITTER_SHARE}}/g, `https://twitter.com/intent/tweet?text=${encodeURIComponent(title)}&url=${pageUrl}`);

        const nextPost = items[i - 1]; 
        const prevPost = items[i + 1];
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
  console.log('🚀 构建完成！所有静态页面和动态内容已汇总至 dist 目录。');
}

run().catch(error => {
    console.error("❌ 构建失败:", error);
    process.exit(1);
});
