import assert from 'node:assert/strict'
import test from 'node:test'
import { buildPoETradePayload } from './poeTrade.js'
import { getVariantStatMatches } from './poeTradeStats.js'

test('matches each Foulborn variant tag to its own row despite partial tradeInfo', async () => {
  const statEntries = [
    { id: 'explicit.stat_armour', text: '(50-100)% increased Armour while Bleeding' },
    { id: 'explicit.stat_immune', text: 'Immune to Elemental Ailments while Bleeding' },
    {
      id: 'explicit.stat_70766949',
      text: 'Gain #% of Maximum Life as Extra Maximum Energy Shield if no Equipped Items are Corrupted',
    },
    {
      id: 'explicit.stat_1750141122',
      text: '#% of Life Regeneration also applies to Energy Shield if no Equipped Items are Corrupted',
    },
    { id: 'explicit.stat_tie_a', text: 'Gain swift movement while Bleeding' },
    { id: 'explicit.stat_tie_b', text: 'Swift movement gain while Bleeding' },
  ]
  const foulbornRows = [
    {
      uniqueItem: 'The Infinite Pursuit',
      originalModifier: 'Cannot be Stunned while Bleeding',
      foulbornModifier: '(50-100)% increased Armour while Bleeding',
    },
    {
      uniqueItem: 'The Infinite Pursuit',
      originalModifier: 'Cannot be Frozen while Bleeding',
      foulbornModifier: 'Immune to Elemental Ailments while Bleeding',
    },
    {
      uniqueItem: "Voll's Vision",
      originalModifier: '(8-12)% increased Maximum Life if no Equipped Items are Corrupted',
      foulbornModifier: '(15-20)% of Life Regeneration also applies to Energy Shield if no Equipped Items are Corrupted',
    },
    {
      uniqueItem: "Voll's Vision",
      originalModifier: 'Regenerate 400 Life per second if no Equipped Items are Corrupted',
      foulbornModifier: 'Gain (8-12)% of Maximum Life as Extra Maximum Energy Shield if no Equipped Items are Corrupted',
    },
    {
      uniqueItem: 'Tie Item',
      originalModifier: 'Cannot be Frozen while Bleeding',
      foulbornModifier: 'While Bleeding, gain swift movement',
    },
  ]
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (url) => ({
    ok: true,
    status: 200,
    json: async () => String(url).includes('/trade/stats')
      ? { result: [{ id: 'explicit', entries: statEntries }] }
      : { rows: foulbornRows },
  })

  try {
    const item = {
      id: 'Unique Armours-136472',
      name: 'Foulborn The Infinite Pursuit',
      category: 'Unique Armours',
      variant: 'Bleed Armour, Bleed Immune',
      variantTags: [],
      explicitModifiers: foulbornRows.map((row) => row.foulbornModifier),
      implicitModifiers: [],
      mutatedModifiers: [],
      tradeInfo: [{ mod: 'explicit.stat_armour' }],
    }
    const siblings = [{
      id: 'base-infinite-pursuit',
      name: 'The Infinite Pursuit',
      category: 'Unique Armours',
      explicitModifiers: foulbornRows.map((row) => row.originalModifier),
      implicitModifiers: [],
      mutatedModifiers: [],
    }]

    const matches = await getVariantStatMatches(item, siblings)

    assert.deepEqual(
      matches.map(({ tag, foulbornMod, matchedStatId }) => ({
        tag,
        foulbornMod,
        matchedStatId,
      })),
      [
        {
          tag: 'Bleed Armour',
          foulbornMod: '(50-100)% increased Armour while Bleeding',
          matchedStatId: 'explicit.stat_armour',
        },
        {
          tag: 'Bleed Immune',
          foulbornMod: 'Immune to Elemental Ailments while Bleeding',
          matchedStatId: 'explicit.stat_immune',
        },
      ],
    )

    const singleTagMatches = await getVariantStatMatches({
      ...item,
      variant: 'Bleed Armour',
      variantTags: [],
      tradeInfo: [],
    }, siblings)
    assert.deepEqual(
      singleTagMatches.map(({ tag, matchedStatId }) => ({ tag, matchedStatId })),
      [{ tag: 'Bleed Armour', matchedStatId: 'explicit.stat_armour' }],
    )

    const vollRows = foulbornRows.filter((row) => row.uniqueItem === "Voll's Vision")
    const vollMatches = await getVariantStatMatches({
      id: 'Unique Armours-volls-vision',
      name: "Foulborn Voll's Vision",
      category: 'Unique Armours',
      variant: 'Uncorrupted Shield, Uncorrupted Regen',
      variantTags: ['Uncorrupted Shield', 'Uncorrupted Regen'],
      baseType: 'Praetor Crown',
      explicitModifiers: [
        '+(263-294) to Armour',
        '+(26-32)% to Fire Resistance',
        '+(8-16)% to Chaos Resistance',
        '20% increased Light Radius',
      ],
      implicitModifiers: [],
      mutatedModifiers: [
        'Gain (8-12)% of Maximum Life as Extra Maximum Energy Shield if no Equipped Items are Corrupted',
        '(15-20)% of Life Regeneration also applies to Energy Shield if no Equipped Items are Corrupted',
      ],
      tradeInfo: [
        { mod: 'explicit.stat_70766949' },
        { mod: 'explicit.stat_1750141122' },
      ],
    }, [{
      id: 'base-volls-vision',
      name: "Voll's Vision",
      category: 'Unique Armours',
      explicitModifiers: vollRows.map((row) => row.originalModifier),
      implicitModifiers: [],
      mutatedModifiers: [],
    }])
    assert.deepEqual(
      vollMatches.map(({ tag, foulbornMod, matchedStatId }) => ({
        tag,
        foulbornMod,
        matchedStatId,
      })),
      [
        {
          tag: 'Uncorrupted Shield',
          foulbornMod: 'Gain (8-12)% of Maximum Life as Extra Maximum Energy Shield if no Equipped Items are Corrupted',
          matchedStatId: 'explicit.stat_70766949',
        },
        {
          tag: 'Uncorrupted Regen',
          foulbornMod: '(15-20)% of Life Regeneration also applies to Energy Shield if no Equipped Items are Corrupted',
          matchedStatId: 'explicit.stat_1750141122',
        },
      ],
    )
    const vollPayload = buildPoETradePayload(
      {
        id: 'Unique Armours-volls-vision',
        name: "Foulborn Voll's Vision",
        category: 'Unique Armours',
        baseType: 'Praetor Crown',
      },
      vollMatches.map((match) => match.matchedStatId),
    )
    assert.deepEqual(
      vollPayload.query.stats[0].filters,
      [
        { id: 'explicit.stat_70766949' },
        { id: 'explicit.stat_1750141122' },
      ],
    )

    for (const [variant, mutatedModifier, statId] of [
      [
        'Uncorrupted Shield',
        'Gain (8-12)% of Maximum Life as Extra Maximum Energy Shield if no Equipped Items are Corrupted',
        'explicit.stat_70766949',
      ],
      [
        'Uncorrupted Regen',
        '(15-20)% of Life Regeneration also applies to Energy Shield if no Equipped Items are Corrupted',
        'explicit.stat_1750141122',
      ],
    ]) {
      const singleModMatches = await getVariantStatMatches({
        id: `Unique Armours-volls-vision-${variant}`,
        name: "Foulborn Voll's Vision",
        category: 'Unique Armours',
        variant,
        variantTags: [variant],
        explicitModifiers: [],
        implicitModifiers: [],
        mutatedModifiers: [mutatedModifier],
        tradeInfo: [{ mod: statId }],
      })
      assert.equal(singleModMatches.length, 1)
      assert.equal(singleModMatches[0].matchedStatId, statId)
    }

    const tieModifier = 'While Bleeding, gain swift movement'
    const tieMatches = await getVariantStatMatches({
      id: 'Unique Jewels-tie-item',
      name: 'Foulborn Tie Item',
      category: 'Unique Jewels',
      variant: 'Bleed Swift',
      variantTags: ['Bleed Swift'],
      explicitModifiers: [tieModifier],
      implicitModifiers: [],
      mutatedModifiers: [],
      tradeInfo: [],
    }, [{
      id: 'base-tie-item',
      name: 'Tie Item',
      category: 'Unique Jewels',
      explicitModifiers: ['Cannot be Frozen while Bleeding'],
      implicitModifiers: [],
      mutatedModifiers: [],
    }])
    assert.equal(tieMatches.length, 1)
    assert.equal(tieMatches[0].matchedStatId, 'explicit.stat_tie_a')
  } finally {
    globalThis.fetch = originalFetch
  }
})
