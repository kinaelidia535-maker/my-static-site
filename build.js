const contentful = require('contentful');
const fs = require('fs');
const { documentToHtmlString } = require('@contentful/rich-text-html-renderer');

const client = contentful.createClient({
  space: process.env.CONTENTFUL_SPACE_ID,
  accessToken: process.env.CONTENTFUL_ACCESS_TOKEN
});

async function run() {
  // 1. 获取所有文章，按创建时间从新到旧排列
  const response = await client.getEntries({ content_type: 'master', order: '-sys.createdAt' });
  const items = response.items;
  const template = fs.readFileSync('./template.html', 'utf8');

  if (!fs.existsSync('./dist')) fs.mkdirSync('./dist');

  items.forEach((item, i) => {
    // 2. 解构字段，加入你新创建的 category
    const { title, body, slug, datedTime, category } = item.fields;
    
    // 3. 核心：处理分类路径
    // 如果你在后台忘了选分类，默认归类到 dynamics
    const cat = (category || 'dynamics').toLowerCase();

    // 4. 转换富文本正文
    const contentHtml = documentToHtmlString(body);

    // 5. 上下页逻辑 (基于全量数据索引)
    const nextPost = items[i - 1]; 
    const prevPost = items[i + 1];

    // 6. 生成社媒分享链接 (关键：URL 路径里要包含分类名)
    const domain = "https://www.mos-surfactant.com";
    const pageUrl = encodeURIComponent(`${domain}/${cat}/${slug}.html`);
    const pageTitle = encodeURIComponent(title);

    const linkedinShare = `https://www.linkedin.com/sharing/share-offsite/?url=${pageUrl}`;
    const facebookShare = `https://www.facebook.com/sharer/sharer.php?u=${pageUrl}`;
    const whatsappShare = `https://api.whatsapp.com/send?text=${pageTitle}%20${pageUrl}`;
    const twitterShare = `https://twitter.com/intent/tweet?text=${pageTitle}&url=${pageUrl}`;

    // 7. 执行 HTML 替换
    let html = template
      .replace(/{{TITLE}}/g, title)
      .replace(/{{CONTENT}}/g, contentHtml)
      .replace(/{{DATE}}/g, datedTime)
      .replace(/{{SLUG}}/g, slug)
      .replace(/{{CATEGORY}}/g, cat); // 方便你在模板里显示当前分类名

    // 8. 填充社媒分享占位符
    html = html
      .replace(/{{LINKEDIN_SHARE}}/g, linkedinShare)
      .replace(/{{FACEBOOK_SHARE}}/g, facebookShare)
      .replace(/{{WHATSAPP_SHARE}}/g, whatsappShare)
      .replace(/{{TWITTER_SHARE}}/g, twitterShare);

    // 9. 填充上下页链接占位符
    // 注意：这里的链接需要加上分类前缀，否则跳转会 404
    html = html.replace('{{PREV_LINK}}', prevPost ? `../${prevPost.fields.category.toLowerCase()}/${prevPost.fields.slug}.html` : '#');
    html = html.replace('{{PREV_TITLE}}', prevPost ? prevPost.fields.title : 'None');
    
    html = html.replace('{{NEXT_LINK}}', nextPost ? `../${nextPost.fields.category.toLowerCase()}/${nextPost.fields.slug}.html` : '#');
    html = html.replace('{{NEXT_TITLE}}', nextPost ? nextPost.fields.title : 'No newer posts');

    // 10. 动态创建分目录并写入文件
    // 路径会变成: ./dist/dynamics/ 或 ./dist/news/ 或 ./dist/knowledge/
    const outDir = `./dist/${cat}`;
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

    fs.writeFileSync(`${outDir}/${slug}.html`, html);
    console.log(`已生成 [${cat.toUpperCase()}]: ${slug}.html`);
  });
}

run().catch(console.error);
