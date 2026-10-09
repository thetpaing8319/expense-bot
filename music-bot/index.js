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
        // သီချင်းရှာဖွေခြင်း
        const searchResults = await scClient.search(query, 'track');

        if (!searchResults || searchResults.length === 0) {
            return ctx.telegram.editMessageText(ctx.chat.id, waitMsg.message_id, undefined, '❌ သီချင်းရှာမတွေ့ပါဘူးဗျ။ တခြားနာမည် ပြောင်းရှာကြည့်ပါ။');
        }

        const track = searchResults[0];
        await ctx.telegram.editMessageText(ctx.chat.id, waitMsg.message_id, undefined, `🎧 **${track.title}** ကို ဆွဲနေပါတယ်... (စက်ထဲသို့ သိမ်းနေသည်)`);

        // 10s ပြဿနာမရှိစေရန် downloadProgressive() ကို အသုံးပြုခြင်း
        const stream = await track.downloadProgressive();
        const fileName = `./${Date.now()}.mp3`;
        const writeStream = fs.createWriteStream(fileName);

        stream.pipe(writeStream);

        writeStream.on('finish', async () => {
            try {
                await ctx.telegram.editMessageText(ctx.chat.id, waitMsg.message_id, undefined, `📤 Telegram သို့ ပို့နေပါပြီ...`);
                
                await ctx.replyWithAudio({
                    source: fileName
                }, {
                    title: track.title,
                    performer: track.author.name || "Unknown Artist"
                });

                if (fs.existsSync(fileName)) fs.unlinkSync(fileName);
                await ctx.telegram.deleteMessage(ctx.chat.id, waitMsg.message_id);

            } catch (sendError) {
                console.error("Telegram Send Error:", sendError);
                ctx.reply('❌ Telegram သို့ ပို့ရာတွင် ဖိုင်ဆိုဒ်ကြီးလွန်းသဖြင့် အမှားအယွင်းဖြစ်သွားပါတယ်။');
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

bot.launch().then(() => console.log('Music Bot is running with SoundCloud Scraper...')).catch(err => console.error(err));