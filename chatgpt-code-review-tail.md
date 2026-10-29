封顶赔付：每一对玩家的实际转账不超过输家可支付余额，并保证赢家增加额与输家减少额完全相等。

P0｜必须修

P0|筹码负数及余额不足|在 settleRound 中按双方可支付余额计算实际转账；每对玩家独立封顶，禁止余额变负。

const delta = Math.min(P.stake * mult, W.chips, L.chips);
ledger[W.id] += delta;
ledger[L.id] -= delta;

注意：上面只是最小示意，实际应根据赢家 W、输家 L 的映射确定可支付余额，并避免使用尚未扣除的下注本金重复计算。

P0|豹子与同花顺优先级反了|PRESET.order 中 tongHuaShun 必须排在 zhenBaoZi 之前，否则同花顺与豹子比较错误。

order: ["tianGong9","tianGong8","sanGui","shuangGui",
"tongHuaShun","zhenBaoZi","jiaBaoZi","hunShun","normal","muShi"],

P0|三鬼与双鬼大小不符合参考源码选择|当前 order 把双鬼放在三鬼之前；SPEC 记录作者源码版三鬼高于双鬼。若 duobi-v1 采用该约定，应把 sanGui 排在 shuangGui 之前，并补双向测试。

P0|特殊克制关系不能靠排序解决|木虱克双鬼、双鬼克天公、天公克木虱是循环关系；三鬼输天公又是独立规则。必须在通用等级比较前处理所有

你说：
继续

继续核对规则、比较逻辑与结算流程

ChatGPT 可能会出错。请核查重要信息。
最新一条回复




思考强度
极高
回答已完成