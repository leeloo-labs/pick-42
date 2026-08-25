# Archetype corpus import

Pick 42 learns successful card clusters from an imported, source-independent deck corpus. It does not scrape 17Lands or Untapped and does not call undocumented APIs. A corpus can come from a manually authorized export, a licensed partner feed, or an offline transformation of a licensed public dataset.

## Paste individual 17Lands trophy decks

Until a set appears in the 17Lands public datasets, individual public trophy lists can be entered without automating the website:

1. Open **Trophy Decks** on 17Lands and select the set and event format.
2. Open one trophy deck and choose **Copy Deck**.
3. In Pick 42, choose **META**, then **Paste Clipboard**. Ordinary `Cmd/Ctrl+V` also works.
4. Enter the set code, event format, final record, and date shown by 17Lands. Rank, archetype label, and deck URL are optional.
5. Choose **Save Trophy Deck**.

Pick 42 accepts Arena-format lines such as `2 Dori, Bearer of Friends (HOB) 123`, ignores the sideboard, and requires at least 40 main-deck cards. It verifies the record against the selected format's trophy threshold and rejects duplicate pasted entries. Card colors and a general color-pair archetype are inferred from fixed mana requirements and the mana base in Arena's installed card catalog when no archetype label is supplied. A small fixed-cost third-color commitment is recorded as a splash; a hybrid payment alternative alone does not make the deck three-color. Existing automatically generated labels are migrated under this rule, while labels entered by the user are preserved.

Pasted entries are kept in Pick 42's legacy-compatible local user-data directory as `manual-archetype-corpus.json`. They are merged in memory with any normalized corpus file selected through **Import CSV / JSON**. Removing a pasted entry from the META panel updates only that local file.

## CSV format

Use one row per main-deck card. The required columns are `Deck ID` and `Card Name`.

```csv
Deck ID,Set Code,Format,Event Date,Record,Rank,Trophy,Archetype,Colors,Card Name,Quantity,Zone
draft-001,HOB,PremierDraft,2026-08-20,7-2,Diamond,true,Boros Dwarves,WR,"Dori, Bearer of Friends",2,Main
draft-001,HOB,PremierDraft,2026-08-20,7-2,Diamond,true,Boros Dwarves,WR,Dwarven Mattock,1,Main
```

`Set Code` and `Format` should be present so Pick 42 can fail closed when the live draft does not match. Supported format labels include `PremierDraft`, `QuickDraft`, `TraditionalDraft`, and `PickTwoDraft`; ordinary names such as `Player Draft` work too. Sideboard rows are ignored when `Zone` contains `Sideboard`.

`Trophy` can be supplied explicitly. If it is blank, Pick 42 infers trophy status from the format and record: seven wins for Premier or Quick Draft, three match wins for Traditional Draft, and four wins for Pick-Two Draft. Keeping non-trophy decks in the same import is useful because Pick 42 can use them as an inclusion-rate baseline.

## JSON format

JSON accepts the same information and may include provenance metadata:

```json
{
  "source": "Authorized local export",
  "license": "Describe the applicable permission or license",
  "generatedAt": "2026-08-20T12:00:00Z",
  "decks": [
    {
      "id": "draft-001",
      "setCode": "HOB",
      "format": "PremierDraft",
      "eventDate": "2026-08-20",
      "record": "7-2",
      "archetype": "Boros Dwarves",
      "colors": "WR",
      "cards": {
        "Dori, Bearer of Friends": 2,
        "Dwarven Mattock": 1
      }
    }
  ]
}
```

## Ranking behavior

The corpus never replaces the 17Lands and Untapped card ratings. Pick 42:

1. Filters to the active set and event format.
2. Requires at least four trophy decks in an archetype.
3. Requires at least two drafted cards that distinguish one corpus archetype from the others.
4. Measures candidate inclusion in that archetype, conditional co-occurrence with the drafted pool, and trophy-versus-general inclusion lift when non-trophy decks are present.
5. Downweights older decklists with a 45-day half-life and shrinks small samples.
6. Caps the resulting adjustment at eight Pick 42 points.

The bounded adjustment feeds the unified **Contextual** ranking only. The **Raw Data** ranking remains an in-a-vacuum blend of the imported card statistics and never receives corpus or pool adjustments. Material contextual adjustments are shown as recommendation reasons, including the matched archetype, inclusion count, and the active-pool cards that supplied the evidence.
