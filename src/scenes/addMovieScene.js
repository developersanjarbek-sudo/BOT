import { Scenes, Markup } from 'telegraf';
import logger from '../utils/logger.js';
import { createMovie } from '../services/movieService.js';
import Movie from '../models/Movie.js';
import Config from '../models/Config.js';

// Auto-generate unique movie code
const generateMovieCode = async () => {
    try {
        const lastMovie = await Movie.findOne().sort({ code: -1 });
        return lastMovie ? lastMovie.code + 1 : 1001;
    } catch (e) {
        return Math.floor(Math.random() * 9000) + 1000;
    }
};

const addMovieScene = new Scenes.WizardScene(
    'ADD_MOVIE_SCENE',
    // Step 1: Ask for title
    async (ctx) => {
        try {
            const nextCode = await generateMovieCode();
            ctx.wizard.state.autoCode = nextCode;

            await ctx.reply(`🎬 <b>Kino qo'shish</b>\n\n📝 Kino nomini kiriting:\n\n<i>Kino kodi avtomatik: <code>${nextCode}</code></i>`, {
                parse_mode: 'HTML',
                ...Markup.inlineKeyboard([
                    [Markup.button.callback('❌ Bekor qilish', 'cancel_add')]
                ])
            });
            return ctx.wizard.next();
        } catch (e) {
            logger.error('Add movie step 1 error:', e);
            await ctx.reply('❌ Xatolik yuz berdi.').catch(() => { });
            return ctx.scene.leave();
        }
    },
    // Step 2: Ask for Year
    async (ctx) => {
        try {
            if (!ctx.message?.text) return ctx.reply('⚠️ Iltimos, matn kiriting.');
            ctx.wizard.state.title = ctx.message.text;
            await ctx.reply('📅 Kino yilini kiriting (masalan: 2024):');
            return ctx.wizard.next();
        } catch (e) {
            logger.error('Add movie step 2 error:', e);
            return ctx.scene.leave();
        }
    },
    // Step 3: Ask for Genre
    async (ctx) => {
        try {
            if (!ctx.message?.text) return ctx.reply('⚠️ Iltimos, yilni kiriting.');
            const year = parseInt(ctx.message.text);
            if (isNaN(year) || year < 1900 || year > 2030) {
                return ctx.reply('⚠️ Noto\'g\'ri yil. Qaytadan kiriting (1900-2030):');
            }
            ctx.wizard.state.year = year;

            await ctx.reply('🎭 Janrni tanlang:', Markup.inlineKeyboard([
                [Markup.button.callback('🥋 Jangari', 'genre_Jangari'), Markup.button.callback('😂 Komediya', 'genre_Komediya')],
                [Markup.button.callback('🎭 Drama', 'genre_Drama'), Markup.button.callback('🚀 Fantastika', 'genre_Fantastika')],
                [Markup.button.callback('👻 Dahshatli', 'genre_Dahshatli'), Markup.button.callback('🌍 Sarguzasht', 'genre_Sarguzasht')],
                [Markup.button.callback('💕 Romantik', 'genre_Romantik'), Markup.button.callback('🎬 Boshqa', 'genre_Boshqa')]
            ]));
            return ctx.wizard.next();
        } catch (e) {
            logger.error('Add movie step 3 error:', e);
            return ctx.scene.leave();
        }
    },
    // Step 4: Wait for genre selection
    async (ctx) => {
        try {
            if (ctx.message?.text) {
                ctx.wizard.state.genre = ctx.message.text;
                await ctx.reply('📝 Kino haqida qisqacha tavsif kiriting:');
                return ctx.wizard.next();
            }
        } catch (e) {
            logger.error('Add movie step 4 error:', e);
        }
    },
    // Step 5: Ask for video
    async (ctx) => {
        try {
            if (!ctx.message?.text) return ctx.reply('⚠️ Iltimos, tavsif kiriting.');
            ctx.wizard.state.description = ctx.message.text;
            await ctx.reply('📥 Kino videosini yuboring:\n\n<i>Video fayl yoki havola yuborishingiz mumkin</i>', { parse_mode: 'HTML' });
            return ctx.wizard.next();
        } catch (e) {
            logger.error('Add movie step 5 error:', e);
            return ctx.scene.leave();
        }
    },
    // Step 6: Ask for poster
    async (ctx) => {
        try {
            if (ctx.message?.video) {
                ctx.wizard.state.fileId = ctx.message.video.file_id;
            } else if (ctx.message?.document) {
                ctx.wizard.state.fileId = ctx.message.document.file_id;
            } else if (ctx.message?.text) {
                ctx.wizard.state.link = ctx.message.text;
            } else {
                return ctx.reply('⚠️ Iltimos, video yoki havola yuboring.');
            }

            await ctx.reply('🖼️ Kino posterini (rasm) yuboring:');
            return ctx.wizard.next();
        } catch (e) {
            logger.error('Add movie step 6 error:', e);
            return ctx.scene.leave();
        }
    },
    // Step 7: Save
    async (ctx) => {
        try {
            if (!ctx.message?.photo) {
                return ctx.reply('⚠️ Iltimos, rasm yuboring.');
            }

            // Get highest resolution photo
            ctx.wizard.state.poster = ctx.message.photo[ctx.message.photo.length - 1].file_id;

            const movieData = {
                title: ctx.wizard.state.title,
                code: ctx.wizard.state.autoCode,
                year: ctx.wizard.state.year,
                genre: ctx.wizard.state.genre || 'Boshqa',
                description: ctx.wizard.state.description,
                fileId: ctx.wizard.state.fileId,
                link: ctx.wizard.state.link,
                poster: ctx.wizard.state.poster
            };

            const movie = await createMovie(movieData);

            // Success msg to Admin
            await ctx.replyWithPhoto(movie.poster, {
                caption: `✅ <b>Kino muvaffaqiyatli saqlandi!</b>\n\n🎬 Nom: ${movie.title}\n📅 Yil: ${movie.year}\n🎭 Janr: ${movie.genre}\n🔢 Kod: <code>${movie.code}</code>\n\n<i>Foydalanuvchilar ${movie.code} kodini yuborib kinoni olishlari mumkin.</i>`,
                parse_mode: 'HTML'
            });

            // 📡 AUTO POST TO CHANNEL
            // Check Config First
            const autoPostConfig = await Config.findOne({ key: 'AUTO_POST_ENABLED' });
            const channelIdConfig = await Config.findOne({ key: 'CHANNEL_ID' });

            const isAutoPostEnabled = autoPostConfig ? autoPostConfig.value : false;
            // Use DB config or Fallback to Env
            const targetChannelId = (channelIdConfig && channelIdConfig.value) ? channelIdConfig.value : process.env.CHANNEL_ID;

            if (isAutoPostEnabled && targetChannelId) {
                try {
                    const channelCaption = `🎬 <b>Yangi Kino!</b>\n\n` +
                        `📛 <b>Nomi:</b> ${movie.title}\n` +
                        `📅 <b>Yili:</b> ${movie.year}\n` +
                        `🎭 <b>Janri:</b> ${movie.genre}\n` +
                        `💿 <b>Sifati:</b> 720p HD\n\n` +
                        `📝 <b>Tavsif:</b> ${movie.description}\n\n` +
                        `📥 <b>Kinoni yuklab olish uchun kod:</b> <code>${movie.code}</code>\n\n` +
                        `🤖 <b>Botga o'tish:</b> @${ctx.botInfo.username}`;

                    await ctx.telegram.sendPhoto(targetChannelId, movie.poster, {
                        caption: channelCaption,
                        parse_mode: 'HTML',
                        ...Markup.inlineKeyboard([
                            [Markup.button.url('📥 Kinoni Yuklash', `https://t.me/${ctx.botInfo.username}?start=${movie.code}`)]
                        ])
                    });
                    await ctx.reply('✅ <b>Kanalga avto-post joylandi!</b>', { parse_mode: 'HTML' });
                } catch (chErr) {
                    logger.error('Channel post error:', chErr);
                    await ctx.reply('⚠️ Kanalga post joylashda xatolik: ' + chErr.message);
                }
            } else if (!isAutoPostEnabled && targetChannelId) {
                await ctx.reply('ℹ️ <b>Avto-post o\'chirilgan.</b> (Sozlamalardan yoqishingiz mumkin)', { parse_mode: 'HTML' });
            }

            return ctx.scene.leave();
        } catch (err) {
            logger.error('Save movie error:', err);
            await ctx.reply('❌ Saqlashda xatolik yuz berdi.').catch(() => { });
            return ctx.scene.leave();
        }
    }
);

// Genre selection handler
addMovieScene.action(/genre_(.+)/, async (ctx) => {
    try {
        const genre = ctx.match[1];
        ctx.wizard.state.genre = genre;
        await ctx.answerCbQuery(`${genre} tanlandi`);
        await ctx.editMessageText(`🎭 Janr: ${genre}\n\n📝 Kino haqida qisqacha tavsif kiriting:`);
        ctx.wizard.selectStep(4);
    } catch (e) {
        logger.error('Genre action error:', e);
    }
});

addMovieScene.action('cancel_add', async (ctx) => {
    try {
        await ctx.editMessageText('❌ Kino qo\'shish bekor qilindi.');
        return ctx.scene.leave();
    } catch (e) {
        return ctx.scene.leave();
    }
});

addMovieScene.command('cancel', async (ctx) => {
    try {
        await ctx.reply('❌ Kino qo\'shish bekor qilindi.');
        return ctx.scene.leave();
    } catch (e) {
        return ctx.scene.leave();
    }
});

export default addMovieScene;
