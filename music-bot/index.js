require('dotenv').config();
const { Telegraf } = require('telegraf');
const play = require('play-dl');
const fs = require('fs');

if (!process.env.BOT_TOKEN) throw new Error('BOT_TOKEN မရှိပါ!');

const bot = new Telegraf(process.env.BOT_TOKEN);

// အရင်က Error တက်သော Client ID ပြဿနာကို ဖြေရှင်းပေးမည့်အပိုင်း
play.getFreeClientID().then((clientID) => {
    play.setToken({
        soundcloud: {
            client_id: clientID
        }
    });
    console.log("SoundCloud Client ID အောင်မြင်စွာ ချိတ်ဆက်ပြီးပါပြီ။");
}).catch(err => console.error("SoundCloud Client ID Error:", err));

bot.start((ctx) => ctx.reply('🎵 Music Bot မှ ကြိုဆိုပါတယ်။\nသီချင်းရှာရန် ဥပမာ: /play လွမ်းရက်တွေ ဟု ရိုက်ထည့်ပါ။'));

bot.command('play', async (ctx) => {
    const query = ctx.message.text.split(' ').slice(1).join(' ');
    
    if (!query) return ctx.reply('ကျေးဇူးပြု၍ သီချင်းနာမည် ရိုက်ထည့်ပါ။ ဥပမာ: /play လွမ်းရက်တွေ');

    const waitMsg = await ctx.reply('🔍 သီချင်းရှာနေပါတယ်... ခဏစောင့်ပါဗျ။');

    try {
        const searchResult = await play.search(query, {
            limit: 1,
            source: { soundcloud: "tracks" }
        });

        if (!searchResult || searchResult.length === 0) {
            return ctx.telegram.editMessageText(ctx.chat.id, waitMsg.message_id, undefined, '❌ သီချင်းရှာမတွေ့ပါဘူးဗျ။ တခြားနာမည် ပြောင်းရှာကြည့်ပါ။');
        }

        const track = searchResult[0];
        await ctx.telegram.editMessageText(ctx.chat.id, waitMsg.message_id, undefined, `🎧 **${track.name}** ကို ဆွဲနေပါတယ်... (စက်ထဲသို့ သိမ်းနေသည်)`);

        // သီချင်းအပြည့်ကို Stream အဖြစ် ဆွဲယူခြင်း
        const stream = await play.stream(track.url);
        const fileName = `./${Date.now()}.mp3`;
        const writeStream = fs.createWriteStream(fileName);

        stream.stream.pipe(writeStream);

        writeStream.on('finish', async () => {
            try {
                await ctx.telegram.editMessageText(ctx.chat.id, waitMsg.message_id, undefined, `📤 Telegram သို့ ပို့နေပါပြီ...`);
                
                await ctx.replyWithAudio({
                    source: fileName
                }, {
                    title: track.name,
                    performer: track.publisher?.artist || "Unknown Artist"
                });

                if (fs.existsSync(fileName)) fs.unlinkSync(fileName);
                await ctx.telegram.deleteMessage(ctx.chat.id, waitMsg.message_id);

            } catch (sendError) {
                console.error("Telegram Send Error:", sendError);
                ctx.reply('❌ Telegram သို့ ပို့ရာတွင် အမှားအယွင်းဖြစ်သွားပါတယ်။');
                if (fs.existsSync(fileName)) fs.unlinkSync(fileName);
            }
        });

        stream.stream.on('error', (err) => {
            console.error("Download Error:", err.message);
            ctx.telegram.editMessageText(ctx.chat.id, waitMsg.message_id, undefined, '❌ ဒေါင်းလုဒ်ဆွဲရာတွင် အမှားအယွင်းဖြစ်သွားပါသည်။');
        });

    } catch (error) {
        console.error("General Error:", error.message);
        ctx.reply('❌ အမှားအယွင်းဖြစ်သွားပါတယ်။');
    }
});

bot.launch().then(() => console.log('Music Bot is running with Play-DL...')).catch(err => console.error(err));