import express from 'express'
import {
  getMarketCategory,
  getMarketRate,
  getMarketSummary,
  getPoeOneLeagues,
} from './poeNinja.js'
import {
  getAccountCharacterItems,
  getAccountCharacters,
  getAccountConfigStatus,
  saveAccountConfig,
} from './poeAccount.js'
import { getWikiItemDetails } from './poeWiki.js'

const app = express()
const port = Number(process.env.PORT) || 3001

app.disable('x-powered-by')
app.use(express.json({ limit: '8kb' }))

function sendAccountError(response, error) {
  const status = Number.isInteger(error?.status) ? error.status : 500
  response.status(status).json({
    error: error instanceof Error ? error.message : 'Account request failed.',
    code: error?.code || 'ACCOUNT_REQUEST_FAILED',
  })
}

app.get('/api/health', (_request, response) => {
  response.json({ status: 'ok' })
})

app.get('/api/wiki/item', async (request, response) => {
  const name = typeof request.query.name === 'string' ? request.query.name.trim() : ''
  const baseType = typeof request.query.baseType === 'string' ? request.query.baseType.trim() : ''
  const variant = typeof request.query.variant === 'string' ? request.query.variant.trim() : ''
  const invalidValue = (value) => value.length > 160 || /[\u0000-\u001f\u007f]/.test(value)
  if (!name || invalidValue(name) || invalidValue(baseType) || invalidValue(variant)) {
    return response.status(400).json({
      error: 'Provide an item name and optional base type and variant, each no longer than 160 characters.',
      code: 'INVALID_ITEM_NAME',
    })
  }

  try {
    const item = await getWikiItemDetails(name, { baseType, variant })
    if (!item) {
      return response.status(404).json({
        error: `No matching PoE Wiki item was found for "${name}".`,
        code: 'WIKI_ITEM_NOT_FOUND',
      })
    }
    response.json(item)
  } catch (error) {
    console.error(`PoE Wiki item lookup failed for "${name}":`, error)
    response.status(502).json({
      error: 'Could not load item details from PoE Wiki.',
      details: error instanceof Error ? error.message : 'Unknown upstream error.',
      code: 'WIKI_REQUEST_FAILED',
    })
  }
})

app.get('/api/account/config', async (_request, response) => {
  try {
    response.json(await getAccountConfigStatus())
  } catch (error) {
    console.error('Account config status failed:', error)
    sendAccountError(response, error)
  }
})

app.post('/api/account/config', async (request, response) => {
  try {
    response.json(await saveAccountConfig(request.body || {}))
  } catch (error) {
    if (error?.status >= 500) console.error('Saving account config failed:', error)
    sendAccountError(response, error)
  }
})

app.get('/api/account/characters', async (_request, response) => {
  try {
    response.json(await getAccountCharacters())
  } catch (error) {
    if (error?.status >= 500) console.error('Loading PoE account characters failed:', error)
    sendAccountError(response, error)
  }
})

app.get('/api/account/character-items', async (request, response) => {
  try {
    response.json(await getAccountCharacterItems(request.query.character))
  } catch (error) {
    if (error?.status >= 500) console.error('Loading PoE character items failed:', error)
    sendAccountError(response, error)
  }
})

app.get('/api/market/leagues', async (_request, response) => {
  try {
    response.json(await getPoeOneLeagues())
  } catch (error) {
    console.error('PoE 1 leagues request failed:', error)
    response.status(502).json({
      error: 'Could not load PoE 1 leagues from poe.ninja.',
      details: error instanceof Error ? error.message : 'Unknown upstream error.',
    })
  }
})

app.get('/api/market/rate', async (request, response) => {
  const league = typeof request.query.league === 'string' ? request.query.league.trim() : ''
  if (!league || league.length > 64 || /[\u0000-\u001f\u007f]/.test(league)) {
    return response.status(400).json({
      error: 'Provide a league name between 1 and 64 characters.',
    })
  }

  try {
    response.json(await getMarketRate(league))
  } catch (error) {
    console.error(`Market rate failed for "${league}":`, error)
    response.status(502).json({
      error: 'Could not load market rate from poe.ninja.',
      details: error instanceof Error ? error.message : 'Unknown upstream error.',
    })
  }
})

app.get('/api/market/category', async (request, response) => {
  const league = typeof request.query.league === 'string' ? request.query.league.trim() : ''
  const category = typeof request.query.category === 'string' ? request.query.category.trim() : ''
  if (!league || league.length > 64 || /[\u0000-\u001f\u007f]/.test(league)) {
    return response.status(400).json({
      error: 'Provide a league name between 1 and 64 characters.',
    })
  }
  if (!category || category.length > 64 || !/^[a-z0-9-]+$/.test(category)) {
    return response.status(400).json({
      error: 'Provide a valid market category.',
    })
  }

  try {
    const result = await getMarketCategory(league, category, {
      refresh: request.query.refresh === '1' || request.query.refresh === 'true',
    })
    if (!result) {
      return response.status(404).json({
        error: `Unknown market category "${category}".`,
        code: 'UNKNOWN_MARKET_CATEGORY',
      })
    }
    response.json(result)
  } catch (error) {
    console.error(`Market category "${category}" failed for "${league}":`, error)
    response.status(502).json({
      error: `Could not load ${category} market data from poe.ninja.`,
      details: error instanceof Error ? error.message : 'Unknown upstream error.',
    })
  }
})

app.get('/api/market/summary', async (request, response) => {
  const league = typeof request.query.league === 'string' ? request.query.league.trim() : ''
  if (!league || league.length > 64 || /[\u0000-\u001f\u007f]/.test(league)) {
    return response.status(400).json({
      error: 'Provide a league name between 1 and 64 characters.',
    })
  }

  try {
    response.json(await getMarketSummary(league, {
      refresh: request.query.refresh === '1' || request.query.refresh === 'true',
    }))
  } catch (error) {
    console.error(`Market summary failed for "${league}":`, error)
    response.status(502).json({
      error: 'Could not load market data from poe.ninja.',
      details: error instanceof Error ? error.message : 'Unknown upstream error.',
    })
  }
})

app.listen(port, '127.0.0.1', () => {
  console.log(`Market API listening on http://127.0.0.1:${port}`)
})
