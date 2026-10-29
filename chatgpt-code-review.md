级别|问题|修法（一行内写完，P0/P1/P2 分组）。必须带代码的只给最小 diff 片段（几行即可）。总输出控制在 4000 字以内，保证不会被界面折叠或截断。
思考了 1m 7s
ChatGPT 说：

审查对象：web/index.html，对照仓库 SPEC-竖屏与工程规格.md 的 duobi-v1。以下是源码静态审查结果，未声称重新运行了浏览器自测。

P0｜必须修

P0|三鬼无法实际出现：牌堆只有 52 张普通牌＋大小王，且 classifyHand 没有识别三鬼的分支；现有三鬼测试实际测成了普通牌|加入第三张鬼牌，并在分类开头识别三鬼，倍率 15。

Diff
- deckSize: 54,
+ deckSize: 55,
+ if (jokers === 3 && n === 3) return {type:"sanGui",pts:0};

P0|双鬼与天公克制关系错误：order 把天公排在双鬼之前，导致双鬼不能克天公|在 compareHands 显式双向处理双鬼与天公，不能只依赖排序。

JavaScript
if (a.type==="shuangGui" && /^tianGong/.test(b.type)) return {r:1,a,b};
if (b.type==="shuangGui" && /^tianGong/.test(a.type)) return {r:-1,a,b};

P0|KA2 被误判为顺子：1,2,13 与 QKA 共用判断分支|严格区分 QKA、A23、KA2。

Diff
- if(s==="1,12,13"||s==="1,2,13") return PRESET.straightAce.includes("QKA");
+ if(s==="1,12,13") return PRESET.straightAce.includes("QKA");
+ if(s==="1,2,13") return false;

P0|KA2 自测是无效断言：实际拿同一个表达式与自身比较，任何结果都会通过|断言必须与明确预期比较。

Diff
- eq("KA2不成顺", ty(ka2), ty(ka2));
+ eq("KA2不成顺", ty(ka2), "normal");

P0|三鬼输天公自测可能假通过：三鬼未被分类成 sanGui，只是靠普通牌等级更低而通过|断言 classifyHand(三鬼).type === "sanGui"，再分别测试双向比较。

P0|下一局重置所有筹码：startRound() 每次重新调用 makePlayers()，导致上一局结算余额丢失|只在首次建桌时创建玩家；下一局保留玩家对象、余额与庄位，仅清空手牌和本局账目。

Diff
- S.players=makePlayers(n,S.ante);
+ if (!S.players.length) S.players=makePlayers(n,S.ante);

P0|筹码可能变负：结算直接按 stake × multiplier 转账，没有余额、下注额或最大赔付校验|下注前检查余额；锁定本金；结算前检查双方可支付金额，明确采用封顶赔付还是

ChatGPT 可能会出错。请核查重要信息。
最新一条回复




思考强度
Pro
回答已完成