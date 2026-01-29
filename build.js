const contentful = require('contentful');
const fs = require('fs');
const { documentToHtmlString } = require('@contentful/rich-text-html-renderer');

const client = contentful.createClient({
  space: process.env.CONTENTFUL_SPACE_ID,
  accessToken: process.env.CONTENTFUL_ACCESS_TOKEN
});

const locales = ['en-US', 'ru'];

async function run() {
  // 确保 dist 根目录存在，防止后续上传 OSS 找不到文件夹
  if (!fs.existsSync('./dist')) fs.mkdirSync('./dist');

  for (const locale of locales) {
    const lang = locale.split('-')[0]; 
    console.log(`正在处理语言 [${lang}]...`);

    const response = await client.getEntries({ 
      content_type: 'master', 
      locale: locale, 
      order: '-sys.createdAt' 
    });
    
    const allEntries = response.items;
    if (allEntries.length === 0) {
        console.log(`语言 [${lang}] 没有找到文章，跳过。`);
        continue;
    }

    const langDir = `./dist/${lang}`;
    if (!fs.existsSync(langDir)) fs.mkdirSync(langDir, { recursive: true });

    // 生成列表页使用的 data.json
    const indexData = allEntries.map(item => {
      let thumbUrl = item.fields.featuredImage?.fields?.file?.url;
      if (!thumbUrl) {
        const randomNum = String(Math.floor(Math.random() * 43) + 1).padStart(2, '0');
        thumbUrl = `/imgs/article_imgs/${randomNum}.png`;
      }
      return {
        title: item.fields.title,
        summary: item.fields.summary || '', 
        date: item.fields.datedTime,
        url: `/${lang}/${(item.fields.category || 'dynamics').toLowerCase()}/${item.fields.slug}.html`,
        img: thumbUrl
      };
    });
    fs.writeFileSync(`${langDir}/data.json`, JSON.stringify(indexData));

    // 处理详情页模板
    const templatePath = `./template_${lang}.html`;
    const template = fs.readFileSync(fs.existsSync(templatePath) ? templatePath : './template.html', 'utf8');

    const groups = { dynamics: [], news: [], knowledge: [] };
    allEntries.forEach(item => {
      const cat = (item.fields.category || 'dynamics').toLowerCase();
      if (groups[cat]) groups[cat].push(item);
      else groups[cat] = [item];
    });

    for (const [catName, items] of Object.entries(groups)) {
      items.forEach((item, i) => {
        const { title, body, slug, datedTime } = item.fields;
        const contentHtml = documentToHtmlString(body);
        const nextPost = items[i - 1]; 
        const prevPost = items[i + 1];

        const domain = "https://www.mos-surfactant.com";
        const pageUrl = encodeURIComponent(`${domain}/${lang}/${catName}/${slug}.html`);

        // --- 修复点：将原来的 category 改为 catName ---
        let html = template
          .replace(/{{TITLE}}/g, title)
          .replace(/{{CONTENT}}/g, contentHtml)
          .replace(/{{DATE}}/g, datedTime)
          .replace(/{{SLUG}}/g, slug)
          .replace(/{{CATEGORY}}/g, catName) // 这里之前写错了
          .replace(/{{LINKEDIN_SHARE}}/g, `https://www.linkedin.com/sharing/share-offsite/?url=${pageUrl}`)
          .replace(/{{FACEBOOK_SHARE}}/g, `https://www.facebook.com/sharer/sharer.php?u=${pageUrl}`)
          .replace(/{{WHATSAPP_SHARE}}/g, `https://api.whatsapp.com/send?text=${encodeURIComponent(title)}%20${pageUrl}`)
          .replace(/{{TWITTER_SHARE}}/g, `https://twitter.com/intent/tweet?text=${encodeURIComponent(title)}&url=${pageUrl}`);

        html = html.replace('{{PREV_LINK}}', prevPost ? `${prevPost.fields.slug}.html` : '#')
                   .replace('{{PREV_TITLE}}', prevPost ? prevPost.fields.title : 'None')
                   .replace('{{NEXT_LINK}}', nextPost ? `${nextPost.fields.slug}.html` : '#')
                   .replace('{{NEXT_TITLE}}', nextPost ? nextPost.fields.title : 'No newer posts');

        const outDir = `${langDir}/${catName}`;
        if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
        fs.writeFileSync(`${outDir}/${slug}.html`, html);
      });
    }
  }
  console.log('所有语种及页面生成完成！');
}

run().catch(error => {
    console.error("构建失败:", error);
    process.exit(1); // 确保 GitHub Actions 接收到错误信号
});
