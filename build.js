const contentful = require('contentful');
const fs = require('fs');
const { documentToHtmlString } = require('@contentful/rich-text-html-renderer');

const client = contentful.createClient({
  space: process.env.CONTENTFUL_SPACE_ID,
  accessToken: process.env.CONTENTFUL_ACCESS_TOKEN
});

async function run() {
  // 获取所有文章，按创建时间倒序排列
  const response = await client.getEntries({ content_type: 'master', order: '-sys.createdAt' });
  const items = response.items;
  const template = fs.readFileSync('./template.html', 'utf8');

  if (!fs.existsSync('./dist')) fs.mkdirSync('./dist');

  items.forEach((item, i) => {
    // 1. 解构 Contentful 字段（确保 hashtags 也在其中）
    const { title, body, slug, datedTime, hashtags } = item.fields;
    
    // 2. 转换富文本正文
    const contentHtml = documentToHtmlString(body);

    // 3. 处理上下页逻辑
    const nextPost = items[i - 1]; // 索引更小的是更新的文章
    const prevPost = items[i + 1]; // 索引更大的是更旧的文章

    // 4. 【新增】生成社媒分享逻辑
    const domain = "https://www.mos-surfactant.com";
    const pageUrl = encodeURIComponent(`${domain}/dynamics/${slug}.html`);
    const pageTitle = encodeURIComponent(title);

    const linkedinShare = `https://www.linkedin.com/sharing/share-offsite/?url=${pageUrl}`;
    const facebookShare = `https://www.facebook.com/sharer/sharer.php?u=${pageUrl}`;
    const whatsappShare = `https://api.whatsapp.com/send?text=${pageTitle}%20${pageUrl}`;
    const twitterShare = `https://twitter.com/intent/tweet?text=${pageTitle}&url=${pageUrl}`;

    // 5. 【新增】处理 Hashtag 标签
    const tagsArray = hashtags || [];
    const hashtagsHtml = tagsArray.map(tag => {
        const cleanTag = tag.startsWith('#') ? tag.slice(1) : tag;
        return `<span class="tag-item-ref">#${cleanTag}</span>`;
    }).join('\n');

    // 6. 执行 HTML 替换
    let html = template
      .replace(/{{TITLE}}/g, title)
      .replace(/{{CONTENT}}/g, contentHtml)
      .replace(/{{DATE}}/g, datedTime)
      .replace(/{{SLUG}}/g, slug) // 方便 <head> 里的 OG 标签使用
      .replace(/{{HASHTAGS_HTML}}/g, hashtagsHtml); // 替换标签占位符

    // 7. 【新增】填充社媒分享占位符
    html = html
      .replace(/{{LINKEDIN_SHARE}}/g, linkedinShare)
      .replace(/{{FACEBOOK_SHARE}}/g, facebookShare)
      .replace(/{{WHATSAPP_SHARE}}/g, whatsappShare)
      .replace(/{{TWITTER_SHARE}}/g, twitterShare);

    // 8. 填充上下页链接占位符
    html = html.replace('{{PREV_LINK}}', prevPost ? `${prevPost.fields.slug}.html` : '#');
    html = html.replace('{{PREV_TITLE}}', prevPost ? prevPost.fields.title : 'None');
    html = html.replace('{{NEXT_LINK}}', nextPost ? `${nextPost.fields.slug}.html` : '#');
    html = html.replace('{{NEXT_TITLE}}', nextPost ? nextPost.fields.title : 'No newer posts');

    // 9. 写入文件
    fs.writeFileSync(`./dist/${slug}.html`, html);
    console.log(`已生成: ${slug}.html`);
  });
}

run().catch(console.error);
