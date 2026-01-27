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
    const { title, body, slug } = item.fields;
    const date = new Date(item.sys.createdAt).toLocaleDateString();
    
    // 转换富文本正文
    const contentHtml = documentToHtmlString(body);

    // 获取上下页逻辑
    const nextPost = items[i - 1]; // 索引更小的是更新的文章
    const prevPost = items[i + 1]; // 索引更大的是更旧的文章

    let html = template
      .replace(/{{TITLE}}/g, title)
      .replace(/{{CONTENT}}/g, contentHtml)
      .replace(/{{DATE}}/g, date);

    // 填充上下页链接占位符
    html = html.replace('{{PREV_LINK}}', prevPost ? `${prevPost.fields.slug}.html` : '#');
    html = html.replace('{{PREV_TITLE}}', prevPost ? prevPost.fields.title : '没有了');
    html = html.replace('{{NEXT_LINK}}', nextPost ? `${nextPost.fields.slug}.html` : '#');
    html = html.replace('{{NEXT_TITLE}}', nextPost ? nextPost.fields.title : '已经是最新');

    fs.writeFileSync(`./dist/${slug}.html`, html);
    console.log(`已生成: ${slug}.html`);
  });
}
run();
