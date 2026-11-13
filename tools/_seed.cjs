// 截图种子数据：写入 localStorage 后由 _shot.cjs 重载页面。
// 与 src/store/AppStore.jsx 的 browserFallback 键名保持一致。
const PREFIX = 'immersive-reader:';

const BOOKS = [
  { id: 'b1', name: '遮天之人王', kind: 'cloud', sourceName: '潘达小说', addedAt: Date.now() - 86400000 * 9, hue: 12, percent: 0.001 },
  { id: 'b2', name: '青山', kind: 'cloud', sourceName: '潘达小说', addedAt: Date.now() - 86400000 * 7, hue: 168, percent: 3.1 },
  { id: 'b3', name: '恶魔培养的淑女', kind: 'cloud', sourceName: '蝙蝠漫画', addedAt: Date.now() - 86400000 * 5, hue: 268, percent: 58 },
  { id: 'b4', name: '异世界的无翼少女', kind: 'local', addedAt: Date.now() - 86400000 * 3, hue: 210, percent: 0.1 },
  { id: 'b5', name: '成为塔防游戏里的暴君', kind: 'cloud', sourceName: '蝙蝠漫画', addedAt: Date.now() - 86400000 * 2, hue: 340, percent: 2 },
  { id: 'b6', name: '德萨罗人鱼', kind: 'cloud', sourceName: 'G社漫画 / 包子漫画', addedAt: Date.now() - 86400000, hue: 195, percent: 0.8 },
  { id: 'b7', name: '山居手记', kind: 'local', addedAt: Date.now() - 86400000 * 12, hue: 88, percent: 46 },
  { id: 'b8', name: '长安十二时辰', kind: 'local', addedAt: Date.now() - 86400000 * 15, hue: 30, percent: 100 },
];

const SAMPLE = `序章

清晨五点，山里的雾还没有散。我推开木窗，看见院子里的桂花树湿漉漉的，叶尖挂着昨夜的水珠。远处的山脊线被雾吞掉了大半，只剩下一道淡淡的青灰色轮廓，像谁用毛笔在宣纸上轻轻拖了一笔。

这是我搬到山里的第三个月。城市的声音渐渐从耳朵里退出去，取而代之的是风穿过竹林的声音，溪水流过石头的声音，还有屋檐下燕子整理羽毛的声音。

第一章 晨雾

山里的早晨来得很慢。天光先是灰的，然后一点点发白，最后才从东边的山坳里透出淡金色。雾是这个时候最浓的，漫过田埂，漫过篱笆，把整座院子都泡在一片牛乳一样的光里。

我习惯在这个时候煮一壶茶。水是山泉，用陶壶在炭炉上慢慢烧。等水开的间隙，我就坐在门槛上看雾。

雾里偶尔会传来声音。有时是远处寺庙的钟声，闷闷的，隔着几重山传过来，已经散得只剩下一点余韵；有时是隔壁老周的咳嗽声，接着是铁门被推开时吱呀的一响，然后是他牵着黄牛走下山坡的脚步声。

第二章 午后

午后是一天里最安静的时候。太阳爬到头顶，把院子晒得暖洋洋的，连风都懒了。桂花树的影子缩成一团，静静地趴在地上。

我搬了一张竹椅到廊下，抱着书看。看不了几页就困了，书滑到胸口，人也就那么睡着了。醒来的时候，常常发现膝盖上落了一片叶子，或者是猫不知什么时候跳上来，在我脚边团成一团，呼噜呼噜地睡。

山里的午后适合浪费。没有会议，没有消息，没有必须完成的事情。时间像溪水一样流，你不需要去追上它。

第三章 夜雨

入夜之后，山里黑得彻底。没有路灯，只有天上的星子，密得不像话，像是有人把一整袋碎银子倒在了黑布上。

雨是半夜来的。先是大颗大颗地砸在瓦上，噼里啪啦，像有人在屋顶上撒豆子。然后越来越密，连成一片，整个世界只剩下雨声。

我躺在床上听雨。这种时候会觉得特别安心——屋顶还在，墙还在，炉子里的火还没灭。外面的世界再大再吵，此刻都被这场雨隔开了。

第四章 雪

山里的第一场雪来得比城里早。某天早上推开门，院子里已经白了一层，桂花树的枝桠上挂着雪，像撒了一层糖霜。

我站在廊下看了很久。雪落得很慢，一片一片的，每一片都清清楚楚。远处的山彻底看不见了，只有白，白到分不出天和地。

那天我没有出门，煮了一整天的茶，把《陶庵梦忆》又翻了一遍。张岱写湖心亭看雪，说「天与云与山与水，上下一白」。我在山里看雪，看到的也是这个。

第五章 春

雪化了之后，春天来得很快。先是溪水涨起来，然后石缝里冒出嫩芽，再然后，一夜之间，满山的野樱都开了。

山里的一年就这样过去。雾、雨、雪、花，一个一个地来，又一个一个地走。我在这里读了很多书，写了一些字，认识了几个人。

有时候会想起城里的日子。地铁、电梯、会议室、屏幕。那些东西现在想起来，像是另一个人的生活。

但也不完全是想念。更多的时候，我只是坐在这里，看着窗外的山，喝着一杯凉了的茶，觉得这样也挺好。

（全文完）`;

const SETTINGS = {
  theme: 'paper',
  fontSize: 18,
  lineHeight: 1.85,
  fontFamily: 'sans',
  pageWidth: 700,
  paragraphSpacing: 1,
  indent: false,
  showProgress: true,
  autoHideUI: false, // 截图关掉：headless 无鼠标移动，chrome 会自动隐藏，看不到顶栏底栏
  reduceMotion: true,  // 截图默认关动效：布局动画截在半途会让画面错乱，不可复现
  skin: 'apple',
  comicFit: 'width',
};

module.exports = function seedScript(name, theme, route, skin) {
  const books = BOOKS.map((b) => ({
    id: b.id,
    name: b.name,
    kind: b.kind,
    sourceName: b.sourceName,
    addedAt: b.addedAt,
    hue: b.hue,
    filePath: b.id === 'b7' ? 'local://b7' : null,
    content: b.id === 'b7' ? SAMPLE : undefined,
  }));
  const progress = {};
  for (const b of BOOKS) {
    if (b.percent > 0) {
      progress[b.id] = {
        percent: b.percent,
        chapterIndex: 2,
        chapterTitle: b.id === 'b7' ? '第二章 午后' : '第八章 归途',
        scrollTop: 0,
        updatedAt: Date.now() - (BOOKS.indexOf(b) + 1) * 3600000,
      };
    }
  }
  const settings = { ...SETTINGS, ...(theme ? { theme } : {}) };
  if (skin) settings.skin = skin;
  return `(() => {
    const L = ${JSON.stringify(PREFIX)};
    localStorage.setItem(L + 'books', ${JSON.stringify(JSON.stringify(books))});
    localStorage.setItem(L + 'progress', ${JSON.stringify(JSON.stringify(progress))});
    localStorage.setItem(L + 'settings', ${JSON.stringify(JSON.stringify(settings))});
    localStorage.setItem(L + 'sources', '[]');
    localStorage.setItem(L + 'rules', '[]');
    ${route ? `window.__SHOT_ROUTE__ = ${JSON.stringify(route)};` : ''}
    return 'seeded';
  })()`;
};
