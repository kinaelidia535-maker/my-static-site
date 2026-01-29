const contentful = require('contentful');
const fs = require('fs');
const { documentToHtmlString } = require('@contentful/rich-text-html-renderer');

const client = contentful.createClient({
  space: process.env.CONTENTFUL_SPACE_ID,
  accessToken: process.env.CONTENTFUL_ACCESS_TOKEN
});

async function run() {
  // 获取所有文章，按创建时间从新到旧排列 (-sys.createdAt)
  const response = await client.getEntries({ content_type: 'master', order: '-sys.createdAt' });
  const items = response.items;
  const template = fs.readFileSync('./template.html', 'utf8');

  if (!fs.existsSync('./dist')) fs.mkdirSync('./dist');

  items.forEach((item, i) => {
    // 1. 解构字段（移除了 hashtags）
    const { title, body, slug, datedTime } = item.fields;
    
    // 2. 转换富文本正文
    const contentHtml = documentToHtmlString(body);

    // 3. 上下页核心逻辑
    const nextPost = items[i - 1]; // 索引更小的是“更新”的文章（下一篇/往新走）
    const prevPost = items[i + 1]; // 索引更大的是“更旧”的文章（上一篇/往旧走）

    // 4. 生成社媒分享链接
    const domain = "https://www.mos-surfactant.com";
    const pageUrl = encodeURIComponent(`${domain}/dynamics/${slug}.html`);
    const pageTitle = encodeURIComponent(title);

    const linkedinShare = `https://www.linkedin.com/sharing/share-offsite/?url=${pageUrl}`;
    const facebookShare = `https://www.facebook.com/sharer/sharer.php?u=${pageUrl}`;
    const whatsappShare = `https://api.whatsapp.com/send?text=${pageTitle}%20${pageUrl}`;
    const twitterShare = `https://twitter.com/intent/tweet?text=${pageTitle}&url=${pageUrl}`;

    // 5. 执行 HTML 替换
    let html = template
      .replace(/{{TITLE}}/g, title)
      .replace(/{{CONTENT}}/g, contentHtml)
      .replace(/{{DATE}}/g, datedTime)
      .replace(/{{SLUG}}/g, slug); 

    // 6. 填充社媒分享占位符
    html = html
      .replace(/{{LINKEDIN_SHARE}}/g, linkedinShare)
      .replace(/{{FACEBOOK_SHARE}}/g, facebookShare)
      .replace(/{{WHATSAPP_SHARE}}/g, whatsappShare)
      .replace(/{{TWITTER_SHARE}}/g, twitterShare);

    // 7. 填充上下页链接占位符
    // 上一篇 (Previous: 时间比当前更早)
    html = html.replace('{{PREV_LINK}}', prevPost ? `${prevPost.fields.slug}.html` : '#');
    html = html.replace('{{PREV_TITLE}}', prevPost ? prevPost.fields.title : 'None');
    
    // 下一篇 (Next: 时间比当前更晚/更新)
    html = html.replace('{{NEXT_LINK}}', nextPost ? `${nextPost.fields.slug}.html` : '#');
    html = html.replace('{{NEXT_TITLE}}', nextPost ? nextPost.fields.title : 'No newer posts');

    // 8. 写入文件
    fs.writeFileSync(`./dist/${slug}.html`, html);
    console.log(`已生成: ${slug}.html`);
  });
}

run().catch(console.error);
