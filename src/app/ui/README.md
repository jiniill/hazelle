# UI components

The rule that keeps a style change to one edit: **raw design values live in `foundation/tokens.css`,
and only this folder styles elements.**

- `foundation/tokens.css` holds every color, font, size, spacing, radius, border width, duration and
  layer (z-index). The palette layer is raw values from the approved mockups; the semantic layer
  (`--color-text-muted`, `--space-16`, `--layer-dialog`, …) is what components use.
- Themes: `:root` in `tokens.css` is dark and `[data-theme='light']` gives every palette-backed
  color token a light value; `[data-bg]`, `[data-ink]`, `[data-dialogue]` and `[data-accent]` turn the page,
  text, dialogue and accent tokens to a color pick. `foundation/theme.ts` (`applyScheme`) sets the attributes on the
  document, and `schemeAttributes` on an element drawn in another scheme (a preset's swatch). A module
  never reads `--palette-*`.
- `foundation/global.css` loads tokens and sets element defaults. `main.tsx` imports it once, then loads
  `foundation/fonts.css` after paint; slow or unavailable webfonts leave the system faces usable. A tool page
  (`sandbox.html`) has no application bootstrap, so `foundation/sandbox.css` imports both directly.
- `foundation/media.ts` lists every media query in `MEDIA` and reads them in JavaScript (`useWide`,
  `useSplit`, `useHover`, `usePanelsBeside`, `useViewport`, `hasFinePointer`). A stylesheet cannot read it, so it writes the query out in full, and
  `media.test.ts` fails on any `@media` that `MEDIA` does not list.
- `foundation/motion.module.css` holds every keyframe, `foundation/a11y.module.css` the
  screen-reader-only box and the one-line ellipsis, and `type.module.css` and `surface.module.css` the looks several
  components share (a note, a detail line, a row's title, a box of rows, a field, a fraction bar). Components take them with `composes` and never redeclare them. These four files sit in the `looks` cascade layer, and `global.css` in `reset` under it, so a component's own rule that changes a property of a look it composes wins whatever order the build gives the files.
- `overlays/layers.ts` is the only document listener for keys and presses. Menus and dialogs join
  its stack with `useLayer`, and Esc or a press outside reaches the newest one only.
- Each component is a `.tsx` named after its main export, with its own `.module.css`, in one of the
  folders below. Each folder has an `index.ts`, and `index.ts` here re-exports them all. Inside the
  kit, files import each other by path, never through an index.

## Rules

- Components take variants, never `className` or `style`; a screen that needs a new look extends a component or adds
  one here. Each prop word has one meaning across the kit:
  - `variant`: which of a component's looks. `size`: how large, a step of a short scale; a slot may decide it. A control's `xs`, `sm`, `md` and `lg` are `--control-xs`, `--control-chip`, `--control-md` and `--control-lg` on every control that takes them.
    `tone`: the colour of what it says: `plain` for neutral, then `muted`, `accent`, `warn` and a component's own
    (a branch, the user's own, faded).
  - `kind`: what a group holds (a toolbar, actions, tags; a menu or a dialog). `gap`: the named room between a
    column's children. `layout`: how a choice's options stand. `density` and `scheme`: a row's height and its place's
    colours.
  - `width`: how wide a screen may grow. `align`: where a frame sets its content (start or center). `level`: a
    heading's level.
  - `current`: the thing open now (`aria-current`). `pressed`: the one picked among choices (`aria-pressed`).
    `selected`: one of a pick of several, absent while not picking. `expanded`: a row open in place.
  - `description`: what a thing holds, under its name. `note`: quiet words by it, by a title, at a row's end (where
    it is used, when, how much) or under a figure (`notes` for several). `detail`: a node under a row, such as a gauge.
    `lines`: a text area's height in lines.
  - `aside`: a column beside the main one, a screen's or a code pane's. `help`: the ⓘ's explanation. `hint`: a
    field's line under it.
- Screens (the feature folders beside this one) and the app shell compose these components, imported from `src/app/ui`. They
  import no CSS and pass no `className` or `style`.
- Only give a palette value a semantic name when its role is visible in an approved mockup.
- The spacing, type and radius scales are short on purpose: pick the step whose role fits, never add a step between
  two for one component. A size several components share, such as a dot or a control's height, takes a size token.

## Patterns

One kind of thing looks and reads one way on every screen. The kit decides what it can; the rest is held here and in
`common/acts.ts` (one word and one icon per act, lint refuses the icons elsewhere) and `common/words.ts`.

- **Button sizes belong to their slot.** A `NavBar`'s actions and a `Section`'s action are `sm`, a `Dialog`'s actions
  and footer `md` (`ButtonSlot`); a caller in a slot passes no `size`. Free-standing buttons keep theirs.
- **A screen's head:** `{noun} 가져오기` (secondary, `ACTS.import`) before `새 {noun}` (secondary, `ACTS.create`);
  nothing primary, except where writing is the screen's whole point: the board's 글쓰기 is primary. What is done to the thing the screen shows (사본 만들기, 기본으로 정하기, 삭제 in `tone="warn"`)
  goes in `NavBar` `menu`, a ⋯, never at the foot of the body. What cannot be done to it now stays there disabled, its
  words saying why, such as 삭제 on the default. A row opened in place (a lorebook entry, a script)
  keeps `이 {noun} 삭제` (danger) at its own foot, and a row's own ⋯ is `MoreMenu`.
- **Words:** 새 X makes a thing of its own, X 추가 adds an entry to its owner's list. Files come in with 가져오기 and go out
  with 내보내기; 불러오는 중 means loading only. A failure offers 다시 시도. Reset is 기본값으로 되돌리기 in the
  section's action, a `link`. Stopping is 멈추기.
- **Rename:** an item named only by its name renames in its title, `NavBar` `rename` (`ItemSection` `rename` where it
  stands under the cards it was picked from), never from a ⋯ and a dialog; one with more identity (a character, a
  persona: name and alias) keeps its 이름 field. A row renames from its ⋯ (`ACTS.rename`). A blank name keeps the old
  one (`TitleField`, `NameDialog`) unless a blank is a value, which `blank` says in a sentence (a model: its catalog name
  stands in), the placeholder then naming what stands in.
- **Lists:** a list of places (`List places`) shows a › on each row; a list of the user's own things shows none.
  Contents go in `description`, where it is used in `note`; an unused thing says nothing there. Counts read
  `{label} N개`, joined by ` · `. The default is the `badge` 기본.
- **Search** comes from `common/useSearch`: the field shows from `SEARCH_FROM` (`common/search.ts`) items and stays while words are typed;
  it stands first in the body's toolbar `Row`, sort and filters beside it. Its no-results `Empty` takes the variant
  of the list's own empty state.
- **Nothing here** is `Empty`, a sentence: `{noun}이 없어요.` An empty list of one's own things offers its first step as `Empty action` (the head's own 새 X or X 가져오기). A failure to load is `Callout tone="warn"` with
  다시 시도. Loading is a note ending in `…`.
- **Controls:** on/off is a `Switch`; one of several is `ChoiceGroup layout="fit"`, a segmented strip for up to
  four short choices and a menu behind a field `ChipButton` past that (`layout="menu"`, quiet words beside the name,
  for a prompt's choice toggle); chips are for filters, and for colour picks, each chip leading with its mark (대사 모양 is `fit`). A shared default
  that cannot be empty steps with a `Stepper`; an override that can be empty, so the default applies, is an emptyable
  number field (`NumberInput`), as the retries are. Explanations go behind ⓘ (`help`), never as visible prose.
- **Focus rings are never cut.** The global ring sits `--focus-ring-reach` outside its element, and a box that scrolls or clips cuts whatever passes its padding. So a field (`surface` `field`, `SearchField`) and a row in a `List box` draw the ring inside, and a scrolling box with no padding of its own keeps that reach as padding, given back with a negative margin (`Dialog`'s body, `Sidebar`'s rail, `AskCard`'s choices). A new scrolling box does the same.
- **Focus in a place to write shows one of two ways.** A field in a form takes the ring. A place written in where a ring would shout strengthens its own border instead: the composer, a title that renames, the chat header's search, a message edited in place (`EditBox`).
- **Width:** settings pages are `page` or `form`, by what the page holds (`Panel`, `Columns`, `PickCard`, `Table` want `page`; a column of rows, `form`); item editors are `form`; a one-step flow (a key, a sign-in) is `narrow`.

## Components

| Folder | Component (other exports) | Stylesheet | What it styles |
| --- | --- | --- | --- |
| foundation | — | `tokens.css`, `global.css` | Every raw value; element defaults, a bare button among them, and reduced motion |
| foundation | — | `motion.module.css` | Every animation: fade, rise, drop, fade away, spin, pulse, blink, waiting dots, sway |
| foundation | — | `a11y.module.css` | Screen-reader-only labels; one-line ellipsis |
| foundation | — | `type.module.css` | Shared text looks: a note (sm; a class named `note` is this one), a detail line (xs; a class named `detail` or `sub`), a row's title, an error line, a field's label |
| foundation | — | `surface.module.css` | Shared surfaces: a box of rows and the line between them, glass over the story, the floating ground of a menu, a dialog or a bubble, a field's frame, a field and its compact size, a fraction bar's track and fill, where a dragged thing would land, an accent dot, a count of what waits behind a button |
| foundation | `media.ts` (`MEDIA`, `useWide`, `useSplit`, `useHover`, `usePanelsBeside`, `useViewport`, `hasFinePointer`) | — | Every breakpoint and media query |
| foundation | `theme.ts` (`applyScheme`, `schemeAttributes`, `THEME`, `BG`, `INK`, `ACCENT`) | — | The theme and color picks on the document or an element |
| foundation | `ColorDot` | `ColorDot.module.css` | A color pick as the current theme draws it |
| foundation | `scrollbar.ts` (`markScrollbars`) | `scrollbar.css` | Classic scrollbars (not overlay ones) as a round thumb without arrows, on the page, its boxes and inside a bot's story |
| foundation | `veil.ts` (`VeilContext`) | — | 이미지 가리기: whether story pictures are covered, and which ones were tapped open |
| foundation | `quotes.ts` (`QuoteShapeContext`, `QUOTE_SHAPE`) | — | 대사 모양: how a story's outermost dialogue and 속마음 marks stand (색만 · 줄바꿈 · 상자 · 점선 속마음); the user's bubble keeps 색만 |
| foundation | `mark.ts` (`MARK`) | — | The one drawing of the logo mark, also read by `brand/render.mjs` for the favicon and icons |
| foundation | `keys.ts` (`Chord`, `pressed`, `pressedKey`, `isComposing`, `keyCaps`, `formatKeys`) | — | Matching a key press, the IME guard, and keys written as text |
| foundation | `Avatar` | `Avatar.module.css` | A face: picture, icon, or a name's first letter, tinted by the name (the user's own in their colour, the operator's in the accent); four sizes, or `fill`, the frame it stands in (`CardGrid`'s pictures) |
| foundation | `Brand` | `Brand.module.css` | The wordmark |
| foundation | `Divider` | `Divider.module.css` | Lines between groups: a labeled line, the story's (with an icon and an action where a branch split) or a toggle list's, one plain rule when it has no label; and the menu, tools and rail lines |
| foundation | `Icon` | `Icon.module.css` | Icon sizes and stroke |
| foundation | `Kbd` (inside the kit only) | `Kbd.module.css` | One key cap, in a notice's action and the 단축키 list |
| foundation | `Byline` | `Byline.module.css` | Who wrote a thing: their face, name and marks, and when, on one line (sm) or with the time under the name (md); the operator's in the accent |
| foundation | `Tag` | `Tag.module.css` | A small label, such as a model's or a character's tag, or 기본 on the default; a tone (accent, success, faint) or one of the faces' tints to tell kinds apart (a post's 분류), an icon before the words, or the icon alone as a square mark |
| foundation | `Text` | `Text.module.css` | A paragraph by its role: body, a note (보조 설명: a status, a limit, a caption under a thing) prose, or written (what someone wrote for others to read, a post or a comment, at reading size); its alignment |
| layout | `Beside` | `Beside.module.css` | The body and a narrower column beside it where both fit, such as 운영's 기록 beside its accounts, the column under the body where not |
| layout | `ChatFrame` (`ChatTitle`, `Reading`, `StageSide`, `readingDefault`; `useMarginRoom` inside the kit only) | `ChatFrame.module.css` | The chat page: a header that hides while the story is read down and a composer dock, both floating over the story; the chat's title, which opens its list of chats; the reading settings as custom properties; a `peek` slot for `SidePeeks`; `panel` beside the story and `beside`, a second panel, only where both fit (`usePanelsBeside`); with `stage`, the story set beside a stage for 삽화 on `side` where it fits (`useMarginRoom`); with `portrait` and no `stage`, that stage holds the character's picture |
| layout | `Columns` | `Columns.module.css` | As many equal columns as fit, each no narrower than its kind (a pick card, a row-like card, a card of settings); one on a narrow page |
| layout | `Disclosure` | `Disclosure.module.css` | A line that opens what is folded under it, such as the settings a model does not take; what is folded is made only while open; `menu`, a ⋯ at the end of the line; `open` and `onOpen` when the caller holds whether it is open |
| layout | `EditorFrame` | `EditorFrame.module.css` | A long thing edited one part at a time: header, outline column, the open part |
| layout | `FaceRow` | `FaceRow.module.css` | A face beside the lines that go with it, centred on it as one block, such as the account's name |
| layout | `FieldRow` | `FieldRow.module.css` | A name and its value as two fields on one line, the name narrower, an action such as delete at the end; the fields show no label, their placeholders name them |
| layout | `ItemSection` | `ItemSection.module.css` | A thing picked from the cards above it as a part of their page, not a page of its own (a `ListDetail` stack): a rule, its name a step under the page title's (with `rename`, the field that renames it, as `NavBar`'s), a line under it, a ⋯ |
| layout | `ListDetail` (`usePane`) | `ListDetail.module.css` | A list beside the item picked from it, or the list stacked over the item in one scroll. `usePane` tells a screen which pane holds it (`stack`: a part of the list's page) |
| layout | `NavBar` (`NavBarProps`) | `NavBar.module.css` | A screen's top row: back (a chevron, an ×, or none), title (or a title that renames), a line under it, save state, actions, a ⋯ menu; its props are the head an editor or list hands the frame it is shown in, a page or a side panel |
| layout | `Panel` | — | A group of a settings page: a `Section` heading with its note, its ⓘ and an action or a switch, at level 3 a subtitle on a hairline; it draws no box, so rows of controls take a `SettingGroup`, a list `List`'s box, and what is only read (figures, gauges) stands open |
| layout | `Row` | `Row.module.css` | Items side by side, wrapping, spaced by kind: a toolbar, actions, tags, a status before its buttons, or one act centred alone under what it answers (a post's 추천) |
| layout | `Screen` | `Screen.module.css` | The page frame, as a page or a pane; narrow, form, wide or page (설정's pages, the column beside the settings sidebar). `aside` adds a column beside the body once the screen is wide enough, stacked above it when not; `stickyAside` keeps it in view as the body scrolls, such as a preview of what the body changes (디스플레이's 미리보기). The edges of its boxes (`SettingGroup`, `List`) stand on the line of its title and section titles. A page sets the page scale its parts read (`--box-inset`, `--section-title`, `--section-gap`, `--box-line`: rows set in from their box's edge, larger section titles, more room between sections, boxes without a line); a side panel keeps the smaller one, and a `Dialog` opened inside a page sets all four back to it |
| layout | `Section` | `Section.module.css` | A titled group, at level 2 on a screen or 3 in a side panel, with an optional tag (the layer a value comes from), note, ⓘ explanation and action by its title |
| layout | `Shell` | `Shell.module.css` | The sidebar beside the page |
| layout | `SidePanel` | `SidePanel.module.css` | A panel beside the page, covering it where narrow |
| layout | `SidePeek` (`SidePeeks`) | `SidePeek.module.css` | A tab at the story's right edge whose drawer slides over the story while the pointer rests on the tab, or stays open from a key or tap, such as 상태; `SidePeeks` holds them in ChatFrame's `peek` slot |
| layout | `Sidebar` (`Rail`, `FaceButton`, `LayerSidebar`) | `Sidebar.module.css` | The sidebar, the rail of faces beside it (the library's actions above the faces, the places into other parts of the app pinned under them); a layer's own sidebar with its title and ×, which Esc closes too, and a search under its title |
| layout | `Stack` | `Stack.module.css` | A column with a named gap: related, group or section |
| layout | `ToolFrame` | `ToolFrame.module.css` | An opaque-origin tool page that fills the rest of its column (a `fill` Screen or SidePanel); the caller connects its window |
| layout | `TranslateDesk` | `TranslateDesk.module.css` | 번역기: a bar of choices, then the source and its translation side by side in one box, taking the height a `fill` Screen leaves, each scrolling its own text (stacked on a narrow page), each pane with a foot of counts and buttons |
| controls | `Button` (`ButtonSlot`, inside the kit only) | `Button.module.css` | Variants (a link and a delete among them), sizes, the busy spinner; the size a slot decides |
| controls | `Checkbox` | `Checkbox.module.css` | A labeled checkbox, with a note after its label, or its label read aloud only beside a row that names it; dimmed when it cannot be ticked |
| controls | `ChipButton` | `ChipButton.module.css` | A rounded button naming a menu's current choice, shaped like a field for a setting, borderless in the composer, or quiet words of at most a narrow chip's width beside a name (value); with a leading icon or face |
| controls | `ChoiceGroup` | `ChoiceGroup.module.css` | Chips (the filter pill `Tabs` draws), equal buttons, a segmented strip, a list with a line under each, a menu from a field chip, or (fit) a strip that becomes that menu past four short options, for one choice; the menu's chip names `empty` while no option is chosen; a shown label sits beside it in a toolbar, and above chips as a field's does; a chip may lead with a mark; cards, a grid of choices each with its mark, label and a line saying what it means, labelled above as a field |
| controls | `Composer` | `Composer.module.css` | The message box, with the chat's tools in its bar and what the message carries above its text; `compact` folds it to one line until focus goes inside; files pasted with no text go to `onFiles` |
| controls | `Attachments` | `Attachments.module.css` | What a message about to be sent carries, as small pictures, each with its upload state and a ✕ |
| controls | `CommentBox` | `CommentBox.module.css` | A comment written in place: text that grows as it is typed, a count or error and its buttons inside the box's foot |
| controls | `EditBox` | `EditBox.module.css` | A message edited in place |
| controls | `FontPicker` | — | The reading font, a menu from a field chip with each face's name drawn in that face, grouped by kind |
| controls | `FileButton` (`pickFiles`) | — | A `Button` that opens a file picker; `pickFiles` opens one from any press, such as a menu item |
| controls | `IconButton` | `IconButton.module.css` | Icon-only buttons and toggles, down to a message's tools; a letter in the icon's place, such as 가; a dot when something behind it needs a look, or a count of what waits behind it, such as the rail's 게시판 |
| controls | `Link` | `Link.module.css` | A link to another site |
| controls | `CodeField`, `CodeEditor.tsx` (inside the kit only), `codeLanguage.ts` | `CodeEditor.module.css` | Code in 크게 편집 and the plugin studio: CodeMirror, loaded on first open with a plain text area standing in, over a `CodeLanguage` its owner fills (its syntax as CodeMirror's Lua or JavaScript mode or its own spans, lint, completion with Tab and snippet stops, hover, Ctrl+/ comment); line numbers, search, multiple cursors; `prose` sets text with code in it in the text face, with its headings, rules and <tags> marked as `MarkupArea` marks them; given `asides`, panes beside the code shown one at a time under tabs of their own (on a narrow screen, tabs after the code's own) whose `reveal` shows the code tab and selects a range |
| controls | `MarkupArea` (`typeInto`, `markup.ts`) | `MarkupArea.module.css` | Prompt text with <tags>, headings, rules and the tags of its `language` (spans) colored on a layer behind the textarea; an insert into it that Ctrl+Z takes back; given `expand` and `language`, the code editor (`CodeField`) as its big editor (`useBigEdit`) from a button beside the text |
| controls | `NumberInput` | `NumberInput.module.css` | A number typed as text, with its unit: no spinner, no scroll-wheel changes; an empty field's placeholder as a hint, or as the value in effect in the muted text color |
| controls | `PickCard` | `PickCard.module.css` | A choice that leads its page, as a card: what it is, what is chosen and where that comes from; opens a menu, or a place; an ⓘ in its corner when given help |
| controls | `PhraseField` | `PhraseField.module.css` | Phrases as removable chips and a field that adds one on Enter, such as stop phrases |
| controls | `Pill` | `Pill.module.css` | A floating button over the story |
| controls | `SearchField` | `SearchField.module.css` | A search box; one that fills a row, such as the chat header's search bar, with its count and buttons at its end |
| controls | `SendButton` | `SendButton.module.css` | Send, or stop a reply |
| controls | `SendNote` | `SendNote.module.css` | A few words beside `SendButton` about what sending now does (the prompt cache's time left); a `warning` adds its words, which phones leave to its icon, and its reason behind an ⓘ; with `onClick` the note is a button that opens where the reason is told, and keeps no ⓘ |
| controls | `Stepper` | `Stepper.module.css` | A whole number stepped one at a time between two bounds, such as the story's text size |
| controls | `Switch` | `Switch.module.css` | An on/off setting that takes effect at once, dimmed while it has no effect |
| controls | `TextField` | `TextField.module.css` | A labeled input or text area with its hint or error, and an ⓘ explanation by its label; read-only on a quieter ground; text taken as typed (a key, an address, a script's code) in the mono face; given `expand`, a text area's big editor (`useBigEdit`) from a button by its label, the code editor (`CodeField`) when given `language` |
| controls | `TitleField` | `TitleField.module.css` | A title that is also the field that renames it; a blank keeps the last name, shown again when the field is left, unless `blank` says what a blank means, which lets it through |
| controls | `ToolButton` | `ToolButton.module.css` | A labeled tool around the story, such as 토글 and 노트, with a count or a dot |
| controls | `VoteButton` | `VoteButton.module.css` | A 추천 one account gives or takes back, its count inside: a column beside a post in a feed, a pill under a post read whole that names itself (`word`); gold once given |
| controls | `useAutosize.ts` (inside the kit only) | — | Grows `Composer`'s and `EditBox`'s text areas with their text |
| controls | `useBigEdit.tsx` (inside the kit only) | `useBigEdit.module.css` | A text area edited big: a quiet button and the caller's keys open the same control over most of the screen (a `full` `Dialog`), bound to the same value with nothing to save; the keys close it, and the caret goes back to the field; the copy hands its caret back through `BigCopy` |
| collections | `Viewport` (`ROWS_RESIZED`, `Seek`) | `Viewport.module.css` | A keyed, measured window of rows within its scroll parent or document, a `ul` of `li` rows when named as a list; keeps focus, row state and jumps across remounts, holds what is being read while rows above it are measured, and says when a row's height changed |
| collections | `Bars` | `Bars.module.css` | One measure over time, a bar per period; the bar pointed at or tapped, else the latest, read out under it |
| collections | `Breakdown` | `Breakdown.module.css` | A total split into parts, the whole named above the bar when given |
| collections | `CardList` (`CardItem`) | `CardList.module.css` | The user's own things as cards across the width, one column in a side panel or on a phone: name, badge and tags, what it holds and where it is used under it (`description`, `note`), a control beside it, something under it such as a gauge (`detail`), and things folded under it (its copies) as rows inside the card, hung from `FolderRow`'s guide line; marked while it is open (`current`, API 연결's connections); a folder among them (`folder`) takes the folder mark and the cards dragged onto it, on its own fill (no ›, which unfolds a card's copies) |
| collections | `CardGrid` (`FaceCard`, `FolderCard`, `Portrait`, `Preview`, `SelectionBar`) | `CardGrid.module.css` | Characters and pictures as cards, folders among them shaped as folders (a tab over up to four faces, each a quarter); with `onPlace`, a card or folder let go beside another of its own lands there, a line in the gap showing where (`cardDrag.ts`); with `arrange`, a handle moves it the same way by pointer of any kind, the arrows, and scrolling at the edge (`cardOrder.tsx`); a card's picture whole in a dialog (`Preview`) |
| collections | `PostCard` (`PostFeed`, `PostStat`) | `PostCard.module.css` | A post in a feed, a card each: its marks, title, two lines of its text, its byline and counts, and a 추천 column pressed without opening it |
| collections | `PathBar` | `PathBar.module.css` | Where a list stands, from the top down |
| collections | `Facts` | `Facts.module.css` | Label and value pairs; `tiles` two to a line on a panel's ground, `row` all in one line, two to a line on a phone; `figures` a row of counts whose values lead |
| collections | `Shares` | `Shares.module.css` | The parts of a total, largest first, each over a bar of its share of the largest |
| collections | `Ranking` (`Ranked`) | `Ranking.module.css` | Things ranked by one measure: a place each, the first three as gold, silver and bronze medals and the first on a gold-edged card, a small mark of its move since an earlier ranking under the place (▲ up, ▼ down, NEW, each in its own color, read aloud in words), a line of facts and a bar of its share of the largest under the name, an optional ⓘ beside the name, the measure at the end; a row without a place (the rest pooled) last, under a dash |
| collections | `Swatches` | `Swatches.module.css` | Looks to pick from as cards, each drawn in its own scheme and face whatever the app's, the current one pressed and checked, an own one with a ⋯ menu; with `onMove`, dragged into another order (`dragOrder.ts`, shared with `Outline`) |
| collections | `FolderMark` | `FolderMark.module.css` | The filled folder mark every folder's row leads with, through the rows' `folder` flag |
| collections | `FolderRow` (`TreeRow`) | `FolderRow.module.css` | A folder's row and the rows inside it, hung from its guide line, which `List`'s and `CardList`'s folded rows hang from too |
| collections | `Item.tsx` (inside the kit only) | `Item.module.css` | Every row picked from a list, which `ItemRow`, `NavRow`, `FolderRow`, `ListItem`, `MenuItem` and `Tabs` fill: leading, title, meta, preview and trailing slots, four densities (chip, the filter pill `Tabs` and `ChoiceGroup`'s chips draw; compact, regular, tall), each place's colours, and the hover and current fills, which `Table` and `ChoiceGroup`'s list compose |
| collections | `ItemRow` | `ItemRow.module.css` | A character or chat in the sidebar; 쓰는 중 |
| collections | `List` (`ListItem`) | `List.module.css` | A list's rows and the lines between them, in a box or not, a › on each row of a list of places and on a folder's row (`folder`, with the folder mark) that opens as a place, none on one that folds in place (`expanded`, its fold chevron before the mark), or, given keys, only the rows near the view; a model id; a figure at a row's end; a muted row standing in for a thing gone; a control beside a row, something under a row's text such as a gauge, and rows set in under it |
| collections | `NavGroup` | `NavGroup.module.css` | A set of places in the app, spaced apart from the next set, such as 설정's; a titled one may hold a head over its places, such as the board's nickname |
| collections | `NavRow` | — | A place in the app, at the sidebar's foot or in a layer's sidebar; a part of a prompt above its outline, with what it holds at its end |
| collections | `StepList` (`StepRow`) | `StepList.module.css` | An evaluation's steps in the order they ran: the source as written in the code face, what it gave, indented by depth, with a note (a condition's verdict, or why it did not run); pressing one asks for its source |
| collections | `Outline` (`OutlineKind`, `OutlineStop`) | `Outline.module.css` | A prompt's blocks as a subway map: stops by kind, the line colored by section, add, remove, drag and key reordering |
| collections | `SettingGroup` (`SettingRow`) | `SettingGroup.module.css` | Settings in one box: each a name, its ⓘ explanation, a line of facts and a preview of the text it holds (a line each, cut to the row's width) beside its control, which goes under them on phones, and its ⋯ menu, which stays at the end of the words' line; a folder's row (`folder`) takes the folder mark before its name; outside a group, a bare row among fields, marked when it differs from its default |
| collections | `Table` (`TableColumn`) | `Table.module.css` | Things compared by the same few facts, a row each that opens its thing or holds its controls; a dash where a row has nothing; narrow, a row becomes its first cell over a summary line and the columns kept; a folder's row (`folder`) takes the folder mark, a › after its name and the rows dragged onto it |
| collections | `SideTitle` | `SideTitle.module.css` | The character whose chats the sidebar lists |
| collections | `Thread` (`ThreadItem`, `ThreadEvent`) | `Thread.module.css` | Comments under a post: a byline and ⋯ over what it says, a foot such as 답글, and its 답글 a step in along a line; between them, a line for something that happened to the post, such as its status set |
| collections | `Tabs` | `Tabs.module.css` | Filters over one list as pills, from `items`, `value` and `onChange`, the picked one pressed |
| overlays | `layers.ts` (`useLayer`, `useAnchored`, `useFocusTrap`, `TAB_STOPS`) | — | The layer stack for Esc and presses outside; a popover fixed by its anchor on the body, flipped to the anchor's other side where it would run off the screen and closed by a scroll (`Hint`, `MascotRemark`); a dialog's focus trap, which starts on the element marked `data-autofocus`, else the first control |
| overlays | `GuideMark`, `Coach` (`guideShown`, `useGuideTarget`) | `Guide.module.css` | A control marked by name without a box of its own; a note by the first marked control on screen with a ring round it, its title, where it stands in its walk and a bar of it, beside the control or over or under it, docked in the corner while no such control is on screen; nothing modal |
| overlays | `ConfirmDialog` | — | A `Dialog` asking before something that cannot be undone |
| overlays | `Dialog` (`Shortcuts`) | `Dialog.module.css` | A small window over the page and its actions; `wide`, a picker at a fixed height, a sheet on a phone; `full`, nearly the whole screen, all of a phone's; the 단축키 list |
| overlays | `PictureView.tsx` (`Pages`, inside the kit only) | `PictureView.module.css` | A picture as large as the window over the dimmed page, a × above it, and its versions stepped under it and with ← →; Esc, a press beside it or × closes it |
| overlays | `DropOverlay` | `DropOverlay.module.css` | The drop target while files are dragged in |
| overlays | `useFileDrop.ts` | — | Whether files are being dragged over the window, and the files dropped, each dropped folder's included; a screen's own drop over the app's, the last mounted over the others |
| overlays | `MoreMenu` | — | The ⋯ that opens what is done to a thing as a whole, in a screen's head (`NavBar` `menu`) or a row, named '{of} 메뉴' |
| overlays | `Hint` | `Hint.module.css` | An ⓘ that shows an explanation (`Help`): after a moment's hover while the pointer stays on the ⓘ or its bubble, or pinned by a click or tap; a help that names a place ends in a door to it, which the caller's `onClick` opens |
| overlays | `Menu` (`MenuItem`, `MenuHeading`, `MenuHandle`, `useMenuHandle`, `useMenuOpener`, `useMenuClose`) | `Menu.module.css` | Menus opened from a button, each keeping its own open state, which a handle shares with other buttons; checked items (one of several or `multiple`), disabled items, and a small form opened the same way (kind dialog) with menus inside it |
| overlays | `Toast` (`ToastAction`) | `Toast.module.css` | A notice on the floating surface, a pill while it is one line: plain (message, detail, one action in the accent, its time running down as a line, ×N when said again) or warn (a warn mark before the words); someone else's words, such as a bot's, on one line after their face and name, 보기 opening the whole; a × on its corner while a pointer is on it, and in the head of a notice opened to stay |
| overlays | `ToastStack` | `ToastStack.module.css` | Notices, newest in front, bottom right (under the header on a phone), those behind as edges the front one's width, and +N for the ones waiting; a mouse pointing at it, or the focus in it, opens it and holds their time, a finger slides one sideways or away from the edge it stands at to put it away. Above every layer but the file drop |
| feedback | `ActionCard` | `ActionCard.module.css` | A large choice with a description |
| feedback | `AskCard` (`AskAnswer`) | `AskCard.module.css` | A question that waits beside what the user is doing, such as a bot's above the composer: who asks, the question with an ⓘ explanation, a line to type or a few choices, and a × that puts it away |
| feedback | `Callout` | `Callout.module.css` | A warning or success note, with an optional action under it |
| feedback | `CodeBlock` | `CodeBlock.module.css` | Text as a program sent it, such as a request's address and body in 요청 원문; in body letters, what a prompt example gives |
| feedback | `CodeCard` | `CodeCard.module.css` | A code to copy, such as the recovery key |
| feedback | `Empty` | `Empty.module.css` | What stands where a list, grid, pane or panel has nothing to show, in the look of where it stands: a body, a section, the story, the pane beside a list, the sidebar or a menu; the first step out of it under the sentence |
| feedback | `Exchange` | `Exchange.module.css` | One ask to a model and its answer, as the plugin studio's AI pane keeps them: the ask in a bubble at the end, the answer's words, what it brought (a change to keep or drop) and a foot line (the model and its cost) |
| feedback | `Gauge` | `Gauge.module.css` | How much of an allowance is used, with a mark where an even use would stand by now, a status word, a note and what is left; figures alone where there is nothing to measure against |
| feedback | `Intro` | `Intro.module.css` | A screen's large title and lead |
| feedback | `NoticeBar` | `NoticeBar.module.css` | A `NoticeCard`'s standing in one line, without the ×, where the card is put away or no longer stands: an icon, the title and its note, actions; such as a guest's home once it holds characters |
| feedback | `NoticeCard` | `NoticeCard.module.css` | What standing somewhere means, where it is decided: a title and its note, points each by an icon, actions, a quiet foot, and a × when it can be put away, such as a guest's limits on home |
| feedback | `Outcome` | `Outcome.module.css` | What an import did not bring, under its title: a line each, with why under it when there is one |
| feedback | `Progress` (`ProgressStep`) | `Progress.module.css` | Work under way. Plain: a row per step with its label, bar and count, and a 전체 row for two or more counted steps. `hero`: the mark filling with the whole and its percent, then the steps as stages (done, under way, still to come). Used by the first load, the Risu move and the backup dialog |
| feedback | `Sketch` (`Sketch.Row`, `Sketch.Line`, `Sketch.Mark`) | `Sketch.module.css` | A picture of a screen drawn in code for a feature tour (`common/Tour`): rows of text bars, `Tag`s and icon marks on a tinted canvas, a count badge in its corner; decorative, the words beside it carry the meaning |
| feedback | `Steps` | `Steps.module.css` | Where the user stands in a short flow of screens, such as signup; the pages of a tour; a tutorial's steps |
| feedback | `Cheer` | `Cheer.module.css` | A finish's picture: a badge with its icon that pops in, rings going out from it and pieces of color thrown round it; only the badge without motion |
| feedback | `TextDiff` (`DiffRun`) | `TextDiff.module.css` | Two versions of one text in one box, in the code face: what only the old one has struck through on a warn tint, what only the new one has on a success tint, a long stretch both share folded to its ends behind a button that opens it, such as a part that broke the cache |
| feedback | `TourCard` | `TourCard.module.css` | A release's tour offered inside its 소식 post: an accent mark, the tour's title and what it holds, and the button that opens it, on an accent-tinted box |
| story | `Story` (`BotButton`, `READER_RESIZED`, `ORIGINAL_MARK`, `storySelection`, `inlaid`) | `Story.module.css`, `Story.shadow.css` | Story text from the engine's HTML, in a shadow root: narration, dialogue, actions, a bot's own HTML and CSS sanitized and kept inside the message, its buttons live or dimmed, and which one was pressed (`BotButton`); math drawn with KaTeX (`math.ts`); the streaming caret; faded while another text will take its place; inlays slotted in where their marks stand, or at the end (`inlaid`); the message's 삽화 (`illustrations`) the same way, or on the stage beside the story (`MarginPictures`) where the chat has room, which `Story` decides (`useMarginRoom`) |
| story | `StoryPicture` | `StoryPicture.module.css` | A picture made for a message (삽화) in its story: its frame at the picture's shape while it loads or is made, the 이미지 가리기 stand-in, and a foot of controls; given `pages`, its versions stepped in that foot and in `PictureView`; pressed, the picture opens in `PictureView` |
| story | `StoryMessage` (`Waiting`, `Switcher`, `Marker`, `Usage`, `Failure`, `TimePinContext`, `useTimePin`; `Speech` inside the kit only) | `StoryMessage.module.css` | One message of the story: who speaks and the user's bubble, which keeps 색만 (`Speech`, which `LogExport` draws too); its time shown by a tap, one row at a time, by its `id` among the rows `TimePinContext` holds (`useTimePin` keeps that state for the chat); `Waiting`, the dots and a `note`; `Usage`, a reply's usage on a quiet line at the end of its text that opens its facts below it and, from them, the whole account; `Switcher`, a step back, the count and a step on, the count picking a version (`pick`) or only read out as it changes, `axis` across or down, `size`; its quiet tag by the name (such as 번역, which flips it), the badges tools put on it (two, then +N), a row under it with its markers (cut, stopped, translation, 삽화) and its tools, its height kept while the tools are absent; a ring that fades from a message looked for, such as a memory record's source; under the avatar, the reader's place in a message taller than the view (`readingRail.ts`, which `ChatFrame` runs): a rail stuck below the header that fills as the message passes the composer, with the share read, fading at its end and without the share while the message is still being written |
| story | `Scrubber` | `Scrubber.module.css` | A track down the story's edge whose thumb stops at each message's start, an even share each; a drag moves the view and names the message in a bubble, and where stops crowd, a finger drawn left steps one at a time; shown while the story moves, pointer only |
| story | `StepButtons` | `StepButtons.module.css` | Up and down a story by its messages, shown while the reader moves over it, the place reached named beside them for a moment; a held press goes to the story's end |
| story | `SelectionButton` (`SelectionEnd`) | `SelectionButton.module.css` | A button at the end of a selection in the story, below its last line or above it near the view's foot, which keeps the selection when pressed, such as 수정 |
| story | `SceneBoard` | `SceneBoard.module.css` | Where each figure of a 삽화's scene stands, on a box of the picture's shape: a chip per figure, its name, dragged by pointer of any kind or moved by the arrows, and a × that takes it out |
| story | `MascotRemark` | `MascotRemark.module.css` | The mascot's line on a reply (마스코트 대사): a pill of its face and ··· at the start of the message's tools, its dots swaying until first opened (in the accent colour under reduced motion); the card above it, the name and the line beside a 3:5 portrait on a cream-to-gold ground, opened by a pointer resting on the pill, a tap, or a key's focus, its picture loaded only once open |
| story | `StatusBox` | `StatusBox.module.css` | A box of a bot's status window (상태창 지정) away from its message, as wide as the story's text: its script's name and actions among several |
| story | `MarginPictures` (inside the kit only) | `MarginPictures.module.css` | A message's 삽화 on the stage beside the story, on its `side`, each level with the paragraph its anchor marks and below the one before, following the reader down its band to the next picture or the message's end; a picture stands by the text and, narrower than it, grows toward and over it to the text's width while pointed at |
| story | `ReadingPreview` (`PreviewRow`) | `ReadingPreview.module.css` | Sample messages drawn as the chat draws them under given reading settings, inert; the reading width does not show |
| story | `LogExport` (`LogRow`, `snapshotPage`, `Snapshot`) | `LogExport.module.css` | A chat drawn once out of sight and handed back as HTML whose look rides in style attributes only (`snapshot.ts`), for pasting on another site: its rows drawn with `Speech`, as the chat draws them; shadow roots read through, pictures whole, and the bot rules a style attribute cannot carry counted; `snapshotPage` wraps it as a file |

## Enforced by `npm run check`

- stylelint: outside `tokens.css`, colors, fonts, spacing, radii, shadows, border widths, z-index,
  animation and transition timings, widths and heights must use `var(--…)`. A width or height may
  also be a percentage, `100dvh` or `max-content`. Hex colors, named colors and `rgb()`/`hsl()` are refused.
- stylelint (`hazelle/shared-looks`, `stylelint-shared-looks.js`): a `.module.css` outside `foundation` fails on a rule that
  redeclares a look of `type.module.css` (its font-size with its weight, or with its colour where it has none, and no
  text property set otherwise) or the fraction bar's `track` of `surface.module.css` (its height and radius with a
  background of its own), or all of `glass`'s or `floating`'s values in a lone class outside an at-rule; it takes the look with `composes`. It reads the looks from those files. It does not see a
  look with a text property of its own added (compose the look, then add it), a grouped or nested selector, or
  `surface`'s other looks.
- Vitest: `foundation/media.test.ts` fails on a media query that `MEDIA` does not list.
- ESLint: no `className` or `style` props and no CSS imports outside this folder and `main.tsx`,
  no hex color strings anywhere in `src/app`, an act's `lucide-react` icon (`ACT_ICONS`) only in `common/acts.ts` and this folder,
  and no retired copy (`RETIRED` in `eslint.config.js`). Nothing here imports anything outside this folder
  but `src/change-signal` (the `ui` area in `eslint/boundaries.js`).
- `typed-css-modules` generates a type for each `.module.css`, so a misspelled class name fails
  the type check. The generated `*.module.d.css.ts` files are not committed.
