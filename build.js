const contentful = require('contentful');
const fs = require('fs');
const { documentToHtmlString } = require('@contentful/rich-text-html-renderer');

const client = contentful.createClient({
  space: process.env.CONTENTFUL_SPACE_ID,
  accessToken: process.env.CONTENTFUL_ACCESS_TOKEN
});

// 设置语言：移除中文，仅保留英文和俄文
const locales = ['en-US', 'ru'];

async function run() {
  for (const locale of locales) {
    const lang = locale.split('-')[0]; // 'en' 或 'ru'
    console.log(`正在处理语言 [${lang}]...`);

    // 1. 获取该语言全量数据
    const response = await client.getEntries({ 
      content_type: 'master', 
      locale: locale, 
      order: '-sys.createdAt' 
    });
    
    const allEntries = response.items;
    if (allEntries.length === 0) continue;

    // 创建语言根目录
    const langDir = `./dist/${lang}`;
    if (!fs.existsSync(langDir)) fs.mkdirSync(langDir, { recursive: true });

    // 2. 生成列表页使用的 data.json [核心改动]
    const indexData = allEntries.map(item => {
      // 封面图逻辑：优先用 Contentful 里的 featuredImage，没有则随机分配 /imgs/article_imgs/01-43.png
      let thumbUrl = item.fields.featuredImage?.fields?.file?.url;
      if (!thumbUrl) {
        const randomNum = String(Math.floor(Math.random() * 43) + 1).padStart(2, '0');
        thumbUrl = `/imgs/article_imgs/${randomNum}.png`;
      }
      return {
        title: item.fields.title,
        summary: item.fields.summary || '', // 记得在 Contentful 增加该字段
        date: item.fields.datedTime,
        url: `/${lang}/${(item.fields.category || 'dynamics').toLowerCase()}/${item.fields.slug}.html`,
        img: thumbUrl
      };
    });
    fs.writeFileSync(`${langDir}/data.json`, JSON.stringify(indexData));

    // 3. 处理详情页
    const templatePath = `./template_${lang}.html`;
    const template = fs.readFileSync(fs.existsSync(templatePath) ? templatePath : './template.html', 'utf8');

    // 按 category 分组以计算同分类内的“上下篇”
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

        let html = template
          .replace(/{{TITLE}}/g, title)
          .replace(/{{CONTENT}}/g, contentHtml)
          .replace(/{{DATE}}/g, datedTime)
          .replace(/{{SLUG}}/g, slug)
          .replace(/{{CATEGORY}}/g, category)
          .replace(/{{LINKEDIN_SHARE}}/g, `https://www.linkedin.com/sharing/share-offsite/?url=${pageUrl}`)
          .replace(/{{FACEBOOK_SHARE}}/g, `https://www.facebook.com/sharer/sharer.php?u=${pageUrl}`)
          .replace(/{{WHATSAPP_SHARE}}/g, `https://api.whatsapp.com/send?text=${encodeURIComponent(title)}%20${pageUrl}`)
          .replace(/{{TWITTER_SHARE}}/g, `https://twitter.com/intent/tweet?text=${encodeURIComponent(title)}&url=${pageUrl}`);

        // 上下篇链接
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

run().catch(console.error);
