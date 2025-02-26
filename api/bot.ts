import { Bot, Context, session, SessionFlavor, webhookCallback } from 'grammy'
import mongoose from 'mongoose'
import { MongoDBAdapter, ISession } from '@grammyjs/storage-mongodb'
import { Menu } from '@grammyjs/menu'
import {
  type Conversation,
  type ConversationFlavor,
  conversations,
  createConversation
} from '@grammyjs/conversations'
import { hydrate, type HydrateFlavor } from '@grammyjs/hydrate'
import { test, resultsArray, TResult } from './test'
import { setDelay } from './helpers'
import dotenv from 'dotenv'

dotenv.config()

const db = process.env.DB
const token = process.env.TOKEN

type MyContext = ConversationFlavor<Context & SessionFlavor<SessionData>>

type TestContext = HydrateFlavor<Context>
type TestConversation = Conversation<MyContext, TestContext>

type TTestStorage = {
  type: string
  answers: Array<number>
  total: number
}
interface SessionData {
  user_info?: {
    id: number
    first_name: string
    is_bot: boolean
    last_name?: string
    username?: string
  }
  tests: Array<TTestStorage>
}

if (!token) throw new Error('Не обнаружен .env')

const bot = new Bot<MyContext>(token)

async function bootstrap() {
  if (!db) throw new Error('Не обнаружен .env')

  await mongoose.connect(db)

  const collection = mongoose.connection.db?.collection<ISession>('sessions')
  if (!collection) throw new Error('Что-то пошло не так')

  await bot.api.setMyCommands([
    { command: 'start', description: 'Запустить бота' }
  ])

  bot.use(
    session({
      storage: new MongoDBAdapter({ collection }),
      initial: () => ({ tests: [] })
    })
  )

  bot.use(async (ctx, next) => {
    if (!ctx?.session?.user_info && ctx.from) {
      const { id, first_name, is_bot, last_name, username } = ctx.from
      ctx.session.user_info = {
        id,
        first_name,
        is_bot,
        last_name,
        username
      }
    }
    await next()
  })

  bot.use(conversations())

  async function depressionTest(
    conversation: TestConversation,
    ctx: TestContext
  ) {
    const answersScores: Array<number> = []
    const array = test.map((answers, questionIndex) => {
      const menu = conversation.menu(`depression-test-${questionIndex}`)

      answers.forEach((answer, answerIndex) => {
        menu
          .text(answer, async (_, next) => {
            if (answersScores[questionIndex] === undefined) {
              answersScores[questionIndex] = answerIndex
              await next()
            }
          })
          .row()
      })

      return menu
    })

    const emptyMenu = conversation.menu()
    const question = await ctx.reply(
      'Что лучше описывает ваше состояние за прошедшую неделю и сегодня?',
      { reply_markup: array[0] }
    )

    await conversation.waitForCallbackQuery(/^depression-test-0/, {
      otherwise: ctx => ctx.reply('Пожалуйста, используйте меню выше!')
    })

    for (let i = 1; i < array.length; i++) {
      await question.editReplyMarkup(emptyMenu)
      await question.editReplyMarkup(array[i])
      await conversation.waitForCallbackQuery(
        new RegExp(`depression-test-${i}`),
        {
          otherwise: ctx => ctx.reply('Пожалуйста, используйте меню выше!')
        }
      )
    }

    await question.delete()

    const total = answersScores.reduce((sum, score) => sum + score, 0)

    let currentResult: TResult | null = null
    let resultIndex = 0
    while (resultIndex < resultsArray.length) {
      const res = resultsArray[resultIndex++]
      if (!res) continue

      currentResult = res

      if (total <= res.border) {
        break
      }
    }

    await conversation.external(ctx => {
      ctx.session.tests.push({
        total,
        answers: answersScores,
        type: 'depression'
      })
    })

    await setDelay(2000)

    if (currentResult) {
      await ctx.reply(
        `Результат онлайн-теста сам по себе не может быть критерием для постановки диагноза депрессии. Диагноз может поставить только специалист по совокупности факторов.`
      )

      await setDelay(500)

      await ctx.reply(currentResult.text, { parse_mode: 'HTML' })

      await setDelay(2000)

      await ctx.reply(
        `Данные результаты являются предварительным. Для более точной диагностики рекомендую записаться ко мне на первую консультацию @yulya_psyhologpomogi\n\nТакже рекомендую подписаться на мой телеграм-канал, где я публикую много полезной информации о психологии и психотерапии бесплатно https://t.me/chestnopropsy.\n\nОставить свой анонимный вопрос вы можете по ссылке https://t.me/askifybot?start=bzyjn, я отвечу на него в своём телеграм-канале https://t.me/chestnopropsy.`,
        { parse_mode: 'HTML' }
      )
      currentResult.extraInfo &&
        (await ctx.reply(currentResult.extraInfo, {
          parse_mode: 'HTML'
        }))
    }

    ctx.api.sendMessage(
      1468598027,
      `${
        ctx.from
          ? `${ctx.from.first_name}${
              ctx.from.last_name ? ` ${ctx.from.last_name}` : ''
            }`
          : 'Аноним'
      } прошел тест на депрессию\nРезультат: ${total}`
    )
  }

  const menu = new Menu<MyContext>('depression-test').text(
    'Начать тест',
    async ctx => {
      await ctx.menu.close({ immediate: true })
      await ctx.conversation.enter('depressionTest')
    }
  )

  bot.use(createConversation(depressionTest, { plugins: [hydrate()] }))
  bot.use(menu)

  bot.command('start', async ctx => {
    const first_name = ctx.from?.first_name
    const hello = `Привет${
      first_name ? `, <strong>${first_name}</strong>` : ''
    }!\nЯ Психодиагност-бот`
    const instructions = `<strong>Инструкция</strong>:\n\nВам предлагается 21 блок по 4 утверждения в каждом, из которых предстоит выбрать одно утверждение, которое лучше всего описывает ваше состояние за прошедшую неделю, включая сегодняшний день.Прежде чем сделать свой выбор, внимательно прочтите все утверждения в каждой группе.`

    await ctx.reply(hello, { parse_mode: 'HTML' })
    await ctx.reply(instructions, {
      parse_mode: 'HTML',
      reply_markup: menu
    })
  })
}

export default webhookCallback(bot, 'https')
