require('dotenv').config();
const { Telegraf } = require('telegraf');
const SoundCloud = require('soundcloud-scraper');
const fs = require('fs');

if (!process.env.BOT_TOKEN) throw new Error('BOT_TOKEN မရှိပါ!');

const bot = new Telegraf(process.env.BOT_TOKEN);
const scClient = new SoundCloud.Client();

bot.start((ctx) => ctx.reply('🎵 Music Bot မှ ကြိုဆိုပါတယ်။\nသီချင်းရှာရန် ဥပမာ: /play လွမ်းရက်တွေ ဟု ရိုက်ထည့်ပါ။'));

bot.command('play', async (ctx) => {
    const query = ctx.message.text.split(' ').slice(1).join(' ');
    
    if (!query) return ctx.reply('ကျေးဇူးပြု၍ သီချင်းနာမည် ရိုက်ထည့်ပါ။ ဥပမာ: /play လွမ်းရက်တွေ');

    const waitMsg = await ctx.reply('🔍 သီချင်းရှာနေပါတယ်... ခဏစောင့်ပါဗျ။');

    try {
        // YouTube ကို လုံးဝမသုံးတော့ဘဲ SoundCloud တွင် တိုက်ရိုက်ရှာဖွေခြင်း
        const scResult = await scClient.search(query, 'track');
        
        if (!scResult || scResult.length === 0) {
            return ctx.telegram.editMessageText(ctx.chat.id, waitMsg.message_id, undefined, '❌ သီချင်းရှာမတွေ့ပါဘူးဗျ။ တခြားနာမည် ပြောင်းရှာကြည့်ပါ။');
        }

        const trackInfo = scResult[0];
        await ctx.telegram.editMessageText(ctx.chat.id, waitMsg.message_id, undefined, `🎧 **${trackInfo.title}** ကို ဆွဲနေပါတယ်... (SoundCloud မှ ဆွဲယူနေပါသည်)`);

        // URL မှတစ်ဆင့် သီချင်းအပြည့်အစုံကို ပြန်ခေါ်ခြင်း (404 Error ဖြေရှင်းရန်)
        const fullTrack = await scClient.getSongInfo(trackInfo.url);
        const stream = await fullTrack.downloadProgressive();
        
        const fileName = `./${Date.now()}.mp3`;
        const writeStream = fs.createWriteStream(fileName);

        stream.pipe(writeStream);

        writeStream.on('finish', async () => {
            try {
                await ctx.telegram.editMessageText(ctx.chat.id, waitMsg.message_id, undefined, `📤 Telegram သို့ ပို့နေပါပြီ...`);
                
                await ctx.replyWithAudio({
                    source: fileName
                }, {
                    title: trackInfo.title,
                    performer: fullTrack.author.name || "Unknown Artist"
                });

                if (fs.existsSync(fileName)) fs.unlinkSync(fileName);
                await ctx.telegram.deleteMessage(ctx.chat.id, waitMsg.message_id);

            } catch (sendError) {
                console.error("Telegram Send Error:", sendError);
                ctx.reply('❌ Telegram သို့ ပို့ရာတွင် အမှားအယွင်းဖြစ်သွားပါတယ်။');
                if (fs.existsSync(fileName)) fs.unlinkSync(fileName);
            }
        });

        stream.on('error', (err) => {
            console.error("Download Error:", err.message);
            ctx.telegram.editMessageText(ctx.chat.id, waitMsg.message_id, undefined, '❌ ဒေါင်းလုဒ်ဆွဲရာတွင် အမှားအယွင်းဖြစ်သွားပါသည်။');
        });

    } catch (error) {
        console.error("General Error:", error.message);
        ctx.telegram.editMessageText(ctx.chat.id, waitMsg.message_id, undefined, '❌ အမှားအယွင်းဖြစ်သွားပါတယ်။ တခြားသီချင်း ပြောင်းရှာကြည့်ပါ။');
    }
});

bot.launch().then(() => console.log('Music Bot is safely running with SoundCloud...')).catch(err => console.error(err));