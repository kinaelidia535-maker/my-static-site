const contentful = require('contentful');
const fs = require('fs');
const { documentToHtmlString } = require('@contentful/rich-text-html-renderer');

const client = contentful.createClient({
  space: process.env.CONTENTFUL_SPACE_ID,
  accessToken: process.env.CONTENTFUL_ACCESS_TOKEN
});

async function run() {
  // 1. 获取全量数据（按时间倒序）
  const response = await client.getEntries({ content_type: 'master', order: '-sys.createdAt' });
  const allEntries = response.items;
  const template = fs.readFileSync('./template.html', 'utf8');

  if (!fs.existsSync('./dist')) fs.mkdirSync('./dist');

  // 2. 将文章按 category 分组
  const groups = {
    dynamics: [],
    news: [],
    knowledge: []
  };

  allEntries.forEach(item => {
    // 确保 category 存在并转为小写，否则归入 dynamics
    const cat = (item.fields.category || 'dynamics').toLowerCase();
    if (groups[cat]) {
      groups[cat].push(item);
    } else {
      // 预防万一有拼写错误或新分类，动态创建分组
      groups[cat] = [item];
    }
  });

  // 3. 遍历每个分类组独立生成页面
  for (const [catName, items] of Object.entries(groups)) {
    console.log(`正在生成 ${catName} 分类，共 ${items.length} 篇文章...`);

    items.forEach((item, i) => {
      const { title, body, slug, datedTime } = item.fields;
      
      // 4. 在当前分类数组（items）内找上下页，彻底解决跳频道问题
      const nextPost = items[i - 1]; // 索引小的是更新的
      const prevPost = items[i + 1]; // 索引大的是更旧的

      // 5. 转换正文
      const contentHtml = documentToHtmlString(body);

      // 6. 生成社媒分享链接（路径包含当前分类）
      const domain = "https://www.mos-surfactant.com";
      const pageUrl = encodeURIComponent(`${domain}/${catName}/${slug}.html`);
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
        .replace(/{{CATEGORY}}/g, catName);

      // 8. 填充分享占位符
      html = html
        .replace(/{{LINKEDIN_SHARE}}/g, linkedinShare)
        .replace(/{{FACEBOOK_SHARE}}/g, facebookShare)
        .replace(/{{WHATSAPP_SHARE}}/g, whatsappShare)
        .replace(/{{TWITTER_SHARE}}/g, twitterShare);

      // 9. 填充上下页逻辑
      // 既然在同一个文件夹内，直接用 slug.html，不再需要 ../
      html = html.replace('{{PREV_LINK}}', prevPost ? `${prevPost.fields.slug}.html` : '#');
      html = html.replace('{{PREV_TITLE}}', prevPost ? prevPost.fields.title : 'None');
      
      html = html.replace('{{NEXT_LINK}}', nextPost ? `${nextPost.fields.slug}.html` : '#');
      html = html.replace('{{NEXT_TITLE}}', nextPost ? nextPost.fields.title : 'No newer posts');

      // 10. 写入分目录
      const outDir = `./dist/${catName}`;
      if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

      fs.writeFileSync(`${outDir}/${slug}.html`, html);
    });
  }
  console.log('所有页面生成完成！');
}

run().catch(console.error);
