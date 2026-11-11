/** Built-in CoC 7th madness dictionary.
 *
 * Data provenance: every symptom below is copied verbatim from the user-supplied
 * 表.txt (CoC 7e Chinese tables). 恐惧症状表 entries 70-100 are the completed
 * tail the user asked to keep for now; entries 1-69 are the official text.
 * This module only looks symptoms up; it never invents content.
 *
 * @module dsh-coc-kp/data/madness
 */

/** Tables exposed by the `roll_madness` tool. `ti` = 临时性疯狂, `li` = 长期性疯狂. */
export type MadnessTableType = 'ti' | 'li'

/** One row of a madness table. */
export interface MadnessEntry {
  /** 1-based roll value of this row. */
  roll: number
  /** Symptom text exactly as printed in the table. */
  symptom: string
}

/** `ti`: 疯狂发作-临时症状（1D10）; `li`: 疯狂发作-总结症状（1D10）. */
export const MADNESS_TABLES: Record<MadnessTableType, readonly MadnessEntry[]> = {
  ti: [{"roll":1,"symptom":"失忆：调查员会发现自己只记得最后身处的安全地点，却没有任何来到这里的记忆。这将会持续1D10轮"},{"roll":2,"symptom":"假性残疾：调查员陷入了心理性的失明，失聪或躯体缺失感中，持续1D10轮"},{"roll":3,"symptom":"暴力倾向：调查员陷入了六亲不认的暴力行为中，对周围的敌人与友方进行着无差别的攻击，持续1D10轮"},{"roll":4,"symptom":"偏执：调查员陷入了严重的偏执妄想之中，持续1D10轮。所有人都想要伤害他们；没有人可以信任；他们正在被监视；有人背叛了他们；他们见到的都是诡计"},{"roll":5,"symptom":"人际依赖：守秘人适当参考调查员的背景中重要之人的条目，调查员因为一些原因而将他人误认为了他重要的人，考虑他们的关系性质，调查员会据此行动，持续1D10轮"},{"roll":6,"symptom":"昏厥：调查员当场昏倒，并需要1D10轮才能苏醒"},{"roll":7,"symptom":"逃避行为：调查员会用任何的手段试图逃离现在所处的位置，即使这意味着开走唯一一辆交通工具并将其它人抛诸脑后，调查员会试图逃离1D10轮"},{"roll":8,"symptom":"竭嘶底里：调查员表现出大笑，哭泣，嘶吼，害怕等的极端情绪表现，持续1D10轮"},{"roll":9,"symptom":"恐惧：调查员投一个D100或者由守秘人选择，来从恐惧症状表中选择一个恐惧源，就算这一恐惧源并不存在，调查员也会在接下来的1D10轮内想象它存在"},{"roll":10,"symptom":"躁狂：调查员投一个D100或者由守秘人选择，来从躁狂症状表中选择一个躁狂的诱因，在接下来的1D10轮内，调查员会渴望沉溺于他新的躁狂症中"}],
  li: [{"roll":1,"symptom":"失忆：回过神来，调查员们发现自己身处一个陌生的地方，并忘记了自己是谁。记忆会随时间缓缓恢复"},{"roll":2,"symptom":"被窃：调查员在1D10小时后恢复清醒，发觉自己被盗，身体毫发无损。如果调查员携带着宝贵之物，做幸运检定来决定其是否被盗。其他所有贵重品无需检定自动消失"},{"roll":3,"symptom":"遍体鳞伤：调查员在1D10小时后恢复清醒，发现自己身上满是拳痕和瘀伤。生命值减少到疯狂前的一半，但这不会造成重伤。调查员没有被窃。这种伤害从何而来由守秘人决定"},{"roll":4,"symptom":"暴力倾向：调查员陷入强烈的暴力与破坏欲之中。当调查员回过神来时，他们做过什么可能很明显，可能被他们记住，也可能并不。调查员对谁或何物施以暴力，他们是杀人还是仅仅造成了伤害，由守秘人决定"},{"roll":5,"symptom":"极端信念：查看调查员背景中的思想信念，调查员会采取极端和疯狂的表现手段展示他们的思想信念之一。比如一个信教者可能之后被发现正在地铁上高声布道"},{"roll":6,"symptom":"重要之人：考虑调查员背景中的重要之人，及其重要的原因。在1D10小时或更久的时间中，调查员将不顾一切地接近那个人，并按照他们之间的关系做出行动"},{"roll":7,"symptom":"被收容：调查员在精神病院病房或警察局牢房中回过神来，他们可能会慢慢回想起导致自己被关在这里的事情"},{"roll":8,"symptom":"逃避行为：调查员恢复清醒时发现自己在很远的地方，也许迷失在荒郊野岭，或是在驶向远方的列车或长途汽车上"},{"roll":9,"symptom":"恐惧：调查员患上一个新的恐惧症。在恐惧症状表上骰1个D100来决定症状，或由守秘人选择一个。调查员在1D10小时后回过神来，并开始为避开恐惧源而采取任何措施"},{"roll":10,"symptom":"躁狂：调查员患上一个新的躁狂症。在躁狂症状表上骰1个D100来决定症状，或由守秘人选择一个。调查员会在1D10小时后恢复理智。在这次疯狂发作中，调查员将完全沉浸于其新的躁狂症状。这对旁人来说是否明显取决于守秘人和玩家"}],
}

/** 恐惧症状表（1D100）. Used to resolve the fear branches of ti/li rows 8/9/10. */
export const FEAR_TABLE: readonly MadnessEntry[] = [{"roll":1,"symptom":"洗澡恐惧症：对洗涤或洗澡的恐惧"},{"roll":2,"symptom":"恐高症：对身处高处的恐惧"},{"roll":3,"symptom":"飞行恐惧症：对飞行的恐惧"},{"roll":4,"symptom":"广场恐惧症：对开放的公共场所的恐惧"},{"roll":5,"symptom":"恐鸡症：对鸡的恐惧"},{"roll":6,"symptom":"大蒜恐惧症：对大蒜的恐惧"},{"roll":7,"symptom":"乘车恐惧症：对乘坐地面载具的恐惧"},{"roll":8,"symptom":"恐风症：对风的恐惧"},{"roll":9,"symptom":"男性恐惧症：对成年男性的恐惧"},{"roll":10,"symptom":"恐英症：对英格兰或其文化的恐惧"},{"roll":11,"symptom":"恐花症：对花的恐惧"},{"roll":12,"symptom":"截肢者恐惧症：对截肢者的恐惧"},{"roll":13,"symptom":"蜘蛛恐惧症：对蜘蛛的恐惧"},{"roll":14,"symptom":"闪电恐惧症：对闪电的恐惧"},{"roll":15,"symptom":"废墟恐惧症：对遗迹或残址的恐惧"},{"roll":16,"symptom":"长笛恐惧症：对长笛的恐惧"},{"roll":17,"symptom":"细菌恐惧症：对细菌的恐惧"},{"roll":18,"symptom":"导弹子弹恐惧症：对导弹或子弹的恐惧"},{"roll":19,"symptom":"跌落恐惧症：对跌倒或摔落的恐惧"},{"roll":20,"symptom":"书籍恐惧症：对书籍的恐惧"},{"roll":21,"symptom":"植物恐惧症：对植物的恐惧"},{"roll":22,"symptom":"美女恐惧症：对美貌女性的恐惧"},{"roll":23,"symptom":"寒冷恐惧症：对寒冷的恐惧"},{"roll":24,"symptom":"恐钟表症：对钟表的恐惧"},{"roll":25,"symptom":"幽闭恐惧症：对封闭空间的恐惧"},{"roll":26,"symptom":"小丑恐惧症：对小丑的恐惧"},{"roll":27,"symptom":"恐犬症：对狗的恐惧"},{"roll":28,"symptom":"恶魔恐惧症：对邪灵或恶魔的恐惧"},{"roll":29,"symptom":"人群恐惧症：对人群的恐惧"},{"roll":30,"symptom":"牙科恐惧症：对牙医的恐惧"},{"roll":31,"symptom":"丢弃恐惧症：对丢弃物件的恐惧"},{"roll":32,"symptom":"皮毛恐惧症：对动物皮毛的恐惧"},{"roll":33,"symptom":"过马路恐惧症：对过马路的恐惧"},{"roll":34,"symptom":"教堂恐惧症：对教堂的恐惧"},{"roll":35,"symptom":"镜子恐惧症：对镜子的恐惧"},{"roll":36,"symptom":"针尖恐惧症：对针或大头针的恐惧"},{"roll":37,"symptom":"昆虫恐惧症：对昆虫的恐惧"},{"roll":38,"symptom":"恐猫症：对猫的恐惧"},{"roll":39,"symptom":"过桥恐惧症：对过桥的恐惧"},{"roll":40,"symptom":"恐老症：对老年人或变老的恐惧"},{"roll":41,"symptom":"恐女症：对女性的恐惧"},{"roll":42,"symptom":"恐血症：对血的恐惧"},{"roll":43,"symptom":"宗教罪行恐惧症：对宗教罪行的恐惧"},{"roll":44,"symptom":"触摸恐惧症：对被触摸的恐惧"},{"roll":45,"symptom":"爬虫恐惧症：对爬行动物的恐惧"},{"roll":46,"symptom":"迷雾恐惧症：对雾的恐惧"},{"roll":47,"symptom":"火器恐惧症：对火器的恐惧"},{"roll":48,"symptom":"恐水症：对水的恐惧"},{"roll":49,"symptom":"催眠恐惧症：对睡眠或被催眠的恐惧"},{"roll":50,"symptom":"白袍恐惧症：对医生的恐惧"},{"roll":51,"symptom":"鱼类恐惧症：对鱼的恐惧"},{"roll":52,"symptom":"蟑螂恐惧症：对蟑螂的恐惧"},{"roll":53,"symptom":"雷鸣恐惧症：对雷声的恐惧"},{"roll":54,"symptom":"蔬菜恐惧症：对蔬菜的恐惧"},{"roll":55,"symptom":"噪音恐惧症：对刺耳噪音的恐惧"},{"roll":56,"symptom":"恐湖症：对湖泊的恐惧"},{"roll":57,"symptom":"机械恐惧症：对机器或机械的恐惧"},{"roll":58,"symptom":"巨物恐惧症：对庞大物件的恐惧"},{"roll":59,"symptom":"捆绑恐惧症：对被捆绑或紧缚的恐惧"},{"roll":60,"symptom":"流星恐惧症：对流星或陨石的恐惧"},{"roll":61,"symptom":"孤独恐惧症：对一人独处的恐惧"},{"roll":62,"symptom":"不洁恐惧症：对污垢或污染的恐惧"},{"roll":63,"symptom":"黏液恐惧症：对黏液的恐惧"},{"roll":64,"symptom":"尸体恐惧症：对尸体的恐惧"},{"roll":65,"symptom":"数字恐惧症：对数字的恐惧"},{"roll":66,"symptom":"恐牙症：对牙齿的恐惧"},{"roll":67,"symptom":"恐梦症：对梦境的恐惧"},{"roll":68,"symptom":"称呼恐惧症：对特定词语的恐惧"},{"roll":69,"symptom":"恐蛇症：对蛇的恐惧"},{"roll":70,"symptom":"恐学症：对学校或学习的恐惧"},{"roll":71,"symptom":"恐镜症：对镜子或反光物的恐惧"},{"roll":72,"symptom":"恐影症：对阴影的恐惧"},{"roll":73,"symptom":"恐科技症：对现代科技的恐惧"},{"roll":74,"symptom":"恐语症：对说话或公开演讲的恐惧"},{"roll":75,"symptom":"恐食症：对进食或某些食物的恐惧"},{"roll":76,"symptom":"恐酒症：对酒精的恐惧"},{"roll":77,"symptom":"恐药症：对药物或医疗的恐惧"},{"roll":78,"symptom":"恐眠症：对睡眠的恐惧"},{"roll":79,"symptom":"恐死症：对死亡的恐惧"},{"roll":80,"symptom":"恐神症：对神明或宗教的恐惧"},{"roll":81,"symptom":"恐鬼症：对鬼魂的恐惧"},{"roll":82,"symptom":"恐外星人症：对外星生物或UFO的恐惧"},{"roll":83,"symptom":"恐血亲症：对亲属或血缘关系的恐惧"},{"roll":84,"symptom":"恐爱症：对恋爱或情感投入的恐惧"},{"roll":85,"symptom":"恐婚症：对婚姻的恐惧"},{"roll":86,"symptom":"恐孕症：对怀孕或婴儿的恐惧"},{"roll":87,"symptom":"恐老病：对疾病或衰老的恐惧"},{"roll":88,"symptom":"恐时间症：对时间流逝的恐惧"},{"roll":89,"symptom":"恐空间症：对空旷或巨大空间的恐惧"},{"roll":90,"symptom":"恐深症：对深水或深渊的恐惧"},{"roll":91,"symptom":"恐高症：对高处的恐惧（另一种）"},{"roll":92,"symptom":"恐低症：对低处或地底的恐惧"},{"roll":93,"symptom":"恐快症：对速度的恐惧"},{"roll":94,"symptom":"恐慢症：对缓慢的恐惧"},{"roll":95,"symptom":"恐无序症：对混乱或无序的恐惧"},{"roll":96,"symptom":"恐秩序症：对过度规则或秩序的恐惧"},{"roll":97,"symptom":"恐未知症：对未知或不可知的恐惧"},{"roll":98,"symptom":"恐自身症：对自身的恐惧"},{"roll":99,"symptom":"恐神志症：对精神失常的恐惧"},{"roll":100,"symptom":"恐克苏鲁神话症：对神话事物的恐惧"}]

/** 躁狂症状表（1D100）. Used to resolve the mania branches of ti/li rows 8/9/10. */
export const MANIA_TABLE: readonly MadnessEntry[] = [{"roll":1,"symptom":"沐浴癖：执着于清洗自己"},{"roll":2,"symptom":"犹豫癖：病态地犹豫不定"},{"roll":3,"symptom":"喜暗狂：对黑暗的过度热爱"},{"roll":4,"symptom":"喜高狂：狂热迷恋高处"},{"roll":5,"symptom":"亲切癖：病态地对他人友好"},{"roll":6,"symptom":"喜旷症：强烈倾向于待在开阔空间"},{"roll":7,"symptom":"喜尖狂：痴迷于尖锐或锋利的物体"},{"roll":8,"symptom":"恋猫狂：近乎病态地对猫友善"},{"roll":9,"symptom":"疼痛癖：痴迷于疼痛"},{"roll":10,"symptom":"喜蒜狂：痴迷于大蒜"},{"roll":11,"symptom":"乘车癖：痴迷于乘坐车辆"},{"roll":12,"symptom":"欣快癖：不正常地感到喜悦"},{"roll":13,"symptom":"喜花狂：痴迷于花朵"},{"roll":14,"symptom":"计算癖：狂热地痴迷于数字"},{"roll":15,"symptom":"消费癖：鲁莽冲动地消费"},{"roll":16,"symptom":"隐居癖：过度地热爱独自隐居"},{"roll":17,"symptom":"芭蕾癖：痴迷于芭蕾舞"},{"roll":18,"symptom":"窃书癖：无法克制偷窃书籍的冲动"},{"roll":19,"symptom":"恋书狂：痴迷于书籍或阅读"},{"roll":20,"symptom":"磨牙癖：无法克制磨牙的冲动"},{"roll":21,"symptom":"灵隐症：病态地坚信自己已被邪恶灵体占据"},{"roll":22,"symptom":"美貌狂：痴迷于自身的美貌"},{"roll":23,"symptom":"地图狂：在任何地方都无法控制查阅地图的冲动"},{"roll":24,"symptom":"跳跃狂：痴迷于从高处跳下"},{"roll":25,"symptom":"喜冷症：对寒冷或寒冷物体的反常喜爱"},{"roll":26,"symptom":"舞蹈狂：无法控制地起舞或发颤"},{"roll":27,"symptom":"恋床癖：过度地热爱待在床上"},{"roll":28,"symptom":"恋墓狂：痴迷于墓地"},{"roll":29,"symptom":"色彩狂：痴迷于某种颜色"},{"roll":30,"symptom":"小丑狂：痴迷于小丑"},{"roll":31,"symptom":"恐惧狂：执着于经历恐怖的场面"},{"roll":32,"symptom":"杀戮癖：痴迷于杀戮"},{"roll":33,"symptom":"魔魅症：病态地坚信自己已被恶魔附身"},{"roll":34,"symptom":"抓挠癖：执着于抓挠自己的皮肤"},{"roll":35,"symptom":"正义狂：痴迷于目睹正义被伸张"},{"roll":36,"symptom":"嗜酒狂：反常地渴求酒精"},{"roll":37,"symptom":"毛皮狂：痴迷于拥有毛皮"},{"roll":38,"symptom":"赠物癖：痴迷于赠送礼物"},{"roll":39,"symptom":"漂泊症：执着于逃离"},{"roll":40,"symptom":"漫游癖：执着于四处漫游"},{"roll":41,"symptom":"自恋狂：近乎病态地以自我为中心或自我崇拜"},{"roll":42,"symptom":"职业狂：对于工作的无尽病态渴求"},{"roll":43,"symptom":"瘾罪症：病态地坚信自己带有罪孽"},{"roll":44,"symptom":"学识狂：痴迷于获取学识"},{"roll":45,"symptom":"静止癖：执着于保持安静"},{"roll":46,"symptom":"乙醚上瘾：渴求乙醚"},{"roll":47,"symptom":"求婚狂：痴迷于进行奇特的求婚"},{"roll":48,"symptom":"狂笑癖：无法自制的强迫性大笑"},{"roll":49,"symptom":"巫术狂：痴迷于女巫与巫术"},{"roll":50,"symptom":"写作癖：痴迷于将每一件事写下来"},{"roll":51,"symptom":"裸体狂：执着于裸露身体"},{"roll":52,"symptom":"妄想狂：近乎病态地充满愉快的妄想"},{"roll":53,"symptom":"蠕虫狂：过度地喜爱蠕虫"},{"roll":54,"symptom":"枪械狂：痴迷于火器"},{"roll":55,"symptom":"饮水狂：反常地渴求水分"},{"roll":56,"symptom":"喜鱼癖：痴迷于鱼类"},{"roll":57,"symptom":"图标狂：痴迷于图标与肖像"},{"roll":58,"symptom":"偶像狂：痴迷于甚至愿献身于某个偶像"},{"roll":59,"symptom":"信息狂：痴迷于积累各种信息与资讯"},{"roll":60,"symptom":"射击狂：反常地执着于射击"},{"roll":61,"symptom":"偷窃癖：反常地执着于偷窃"},{"roll":62,"symptom":"噪音癖：无法自制地执着于制造响亮或刺耳的噪音"},{"roll":63,"symptom":"喜线癖：痴迷于线绳"},{"roll":64,"symptom":"彩票狂：极端地执着于购买彩票"},{"roll":65,"symptom":"抑郁症：近乎病态的重度抑郁倾向"},{"roll":66,"symptom":"巨石狂：站在石环或立起的巨石旁时，会近乎病态地写出各种奇怪的创意"},{"roll":67,"symptom":"旋律狂：痴迷于音乐或一段特定的旋律"},{"roll":68,"symptom":"作诗癖：无法抑制地想要不停作诗"},{"roll":69,"symptom":"憎恨癖：憎恨一切事物，痴迷于憎恨某个事物或团体"},{"roll":70,"symptom":"偏执狂：近乎病态地痴迷与专注某个特定的想法或创意"},{"roll":71,"symptom":"夸大癖：以一种近乎病态的程度说谎或夸大事物"},{"roll":72,"symptom":"臆想症：妄想自己正在被某种臆想出的疾病折磨"},{"roll":73,"symptom":"记录癖：执着于记录一切事物（例如摄影）"},{"roll":74,"symptom":"恋名狂：痴迷于名字（人物的、地点的、事物的）"},{"roll":75,"symptom":"称名癖：无法抑制地不断重复某个词语的冲动"},{"roll":76,"symptom":"剔指癖：执着于剔指甲"},{"roll":77,"symptom":"恋食癖：对某种食物的病态热爱"},{"roll":78,"symptom":"抱怨癖：一种在抱怨时产生的近乎病态的愉悦感"},{"roll":79,"symptom":"面具狂：执着于佩戴面具"},{"roll":80,"symptom":"幽灵狂：痴迷于幽灵"},{"roll":81,"symptom":"谋杀癖：病态的谋杀倾向"},{"roll":82,"symptom":"渴光癖：对光的病态渴求"},{"roll":83,"symptom":"背德癖：病态地渴求违背社会道德"},{"roll":84,"symptom":"求财癖：对财富的强迫性渴望"},{"roll":85,"symptom":"欺骗狂：无法抑制的执着于撒谎"},{"roll":86,"symptom":"纵火狂：执着于纵火"},{"roll":87,"symptom":"提问狂：执着于提问"},{"roll":88,"symptom":"挖鼻癖：执着于挖鼻子"},{"roll":89,"symptom":"涂鸦癖：沉迷于涂鸦"},{"roll":90,"symptom":"列车狂：认为火车或类似交通工具是活的生物"},{"roll":91,"symptom":"臆智症：臆想自己拥有难以置信的智慧"},{"roll":92,"symptom":"科技狂：痴迷于新的科技"},{"roll":93,"symptom":"瘾咒狂：坚信自己被某种死亡魔法所诅咒"},{"roll":94,"symptom":"臆神狂：坚信自己是一位神灵"},{"roll":95,"symptom":"抓挠癖：抓挠自己的强迫倾向"},{"roll":96,"symptom":"手术狂：对进行手术的不正常爱好"},{"roll":97,"symptom":"拔毛癖：执着于拔下自己的头发"},{"roll":98,"symptom":"臆盲症：病理性的失明"},{"roll":99,"symptom":"嗜外狂：痴迷于异国的事物"},{"roll":100,"symptom":"喜兽癖：对待动物的态度近乎疯狂地友好"}]

/** Uniform integer roll in 1..size, clamped away from the rng() === 1 edge. */
export function rollIndex(size: number, rng: () => number = Math.random): number {
  if (!Number.isInteger(size) || size < 1) throw new Error(`无效的表长度: ${size}`)
  const value = Math.floor(rng() * size) + 1
  return value < 1 ? 1 : value > size ? size : value
}

/** Draw one row from any table, returning the roll and its symptom. */
export function drawEntry(entries: readonly MadnessEntry[], rng: () => number = Math.random): MadnessEntry {
  if (entries.length === 0) throw new Error('疯狂表为空')
  const roll = rollIndex(entries.length, rng)
  const entry = entries.find((item) => item.roll === roll) ?? entries[0]
  return { roll: entry.roll, symptom: entry.symptom }
}

/** Draw one symptom from `ti` or `li`. */
export function rollMadness(table: MadnessTableType, rng: () => number = Math.random): { roll: number; symptom: string } {
  const entries = MADNESS_TABLES[table]
  if (entries === undefined) throw new Error(`未知的疯狂表: ${table}`)
  return drawEntry(entries, rng)
}

/** Draw one 恐惧症状 (1D100). */
export function rollFear(rng: () => number = Math.random): { roll: number; symptom: string } {
  return drawEntry(FEAR_TABLE, rng)
}

/** Draw one 躁狂症状 (1D100). */
export function rollMania(rng: () => number = Math.random): { roll: number; symptom: string } {
  return drawEntry(MANIA_TABLE, rng)
}
