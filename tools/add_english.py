#!/usr/bin/env python3
"""English subtitles: add `quote_en` to every voiced slot of data/script.json.

Subtitle register — short, spoken, same beat as the Chinese line; names stay pinyin.
Re-runnable: only slots whose Chinese quote matches get the English line.
"""
import json
from pathlib import Path

P = Path(__file__).resolve().parent.parent

EN = {
    1: "Ma'am, who are you looking for?",
    2: "The other woman!",
    3: "I'm looking for Chen Junsheng's mistress. She works here!",
    4: "I don't know.",
    5: "You don't know?",
    6: "Fine. Then it's you. Come on, outside with me!",
    7: "It's not me, ma'am. You've got the wrong person, ma'am.",
    8: "Then who is it? Who?",
    9: "They say it's Ling Ling.",
    10: "Ling Ling, is it? Fine. Ling Ling!",
    11: "Ma'am, um, this is where we work.",
    12: "You're Ling Ling, aren't you? Come on, move!",
    13: "I'm not. I...",
    14: "You're not Ling Ling? Then who are you?",
    15: "My name is Hong!",
    16: "Fine, fine. Then mind your own business!",
    17: "Who is Ling Ling? Ling Ling!",
    18: "Ma'am, this is an office. It's not the place. If there's a problem, let's talk outside.",
    19: "Are you Ling Ling?",
    20: "I... I'm not Ling Ling.",
    21: "If you're not Ling Ling, stay out of it. If you are, come with me!",
    22: "I'm not Ling Ling, ma'am. You've got the wrong person. Whatever it is, let's talk outside, okay?",
    23: "Why should I take it outside? Stop interfering!",
    24: "Ling Ling! Ling Ling!",
    25: "Ma'am, please don't do this.",
    26: "This isn't right. This isn't the place.",
    27: "Which one of you is Ling Ling?!",
    28: "You're Ling Ling, aren't you?",
    29: "No mistake!",
    30: "Come on. Step outside with me!",
    31: "Who are you? I'm calling the police.",
    32: "Who am I?!",
    33: "Listen carefully!",
    34: "I am Luo Zijun's mother. Chen Junsheng's mother-in-law!",
    35: "Calling the police? Fine. Go ahead!",
    36: "Let's see what the police do with a tramp like you!",
    37: "Let me tell you, in the old days a woman like you would be drowned in the pond and beaten to death!",
    38: "You hear me? That would be the end of you!",
    39: "I'm telling you, if you're not afraid of me saying every ugly thing right here, then I'll say it right here!",
    40: "Otherwise you come quietly with me to the door!",
    41: "Move! Move!",
    42: "Out!",
    44: "Let me tell you, all my life, what I hate most is a third party who breaks up a family!",
    45: "Even one I only hear about, someone I don't know, I curse her out and wish her ill!",
    46: "Let alone you!",
    47: "You went after my own daughter!",
    48: "I'll give you one last chance. Pack up, get out of Chen Junsheng's sight this instant, and disappear!",
    49: "Or else heaven will strike down your whole family!",
    50: "Ma'am, do you think cursing and swearing helps with something like this?",
    51: "You can be angry. You can scold me.",
    52: "But let me tell you: flies don't land on an egg that has no cracks.",
    53: "If the egg is already cracked, what good does swatting the fly do?",
    54: "It takes two hands to clap.",
    55: "Even without me, Chen Junsheng and your daughter were already miserable together long ago.",
    56: "Miserable? Fine, miserable!",
    57: "Let me tell you, wasn't Chen Junsheng putting on his act, getting through it day after day?",
    58: "How come the moment you showed up, he couldn't hold it together anymore?",
    59: "Besides, how many couples these days are miserable? They don't all get divorced, do they?",
    60: "How come the moment you showed up, he... he wants a divorce?",
    61: "I'm telling you, if you're just playing around with Chen Junsheng, you've had your fun. Play any more and it breaks. Understand?",
    62: "We both have children, we both have jobs. We're past the age of playing around.",
    63: "Something this big, neither of us can afford to play with.",
    64: "Can't afford to play?",
    65: "You both have careers, you both have families!",
    66: "So you're saying you're serious, is that it?!",
    68: "Did you all hear that? Did you all hear what she just said?",
    69: "You still dare to work alongside someone like this? Do you?",
    70: "Where do you think you're going?",
    71: "I'm going to work.",
    72: "Work? You tore a family apart. Wife, child, home, everything!",
    73: "You want to go to work? This isn't over!",
    74: "Until this is settled, it is not over!",
    75: "What's going on? No scenes here. Come on, out. No scenes here!",
    76: "What are you pulling me for?!",
    77: "I'm telling you, I'll be back tomorrow. This isn't over!",
    78: "Work, work, work. Move along, move along.",
    79: "Break it up, break it up. Move along.",
    80: "Nothing to see here. Move along, move along. Back to work. Back to your desks.",
}

S = json.load(open(P / "data/script.json", encoding="utf-8"))
n = 0
for L in S["lines"]:
    if L.get("quote") and L["id"] in EN:
        L["quote_en"] = EN[L["id"]]; n += 1
    else:
        L.pop("quote_en", None)
missing = [L["id"] for L in S["lines"] if L.get("quote") and "quote_en" not in L]
S["meta"]["content"] = S["meta"]["content"].split(" quote_en")[0] + " quote_en = the same line in English (subtitle only; the voice is Chinese)."
json.dump(S, open(P / "data/script.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print(f"{n} English lines written; missing: {missing}")
