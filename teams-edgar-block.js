// ─────────────────────────────────────────────────────────────────────────────
// EDGAR NAVARRETE ORG — paste this block INSIDE your existing `const TEAM = { }`
// object in src/teams.js (anywhere among the other entries). It attaches to your
// existing 'OVERALL_AGENCY' node, so do NOT redefine OVERALL_AGENCY here.
//
// This keeps your repo's teams.js in sync with the live Supabase table. The
// matching SQL (ofg-edgar-org-seed.sql) is what actually makes tracking go live.
//
// Real Discord IDs used where provided. 'NJ_*' = not on Discord yet — replace the
// key AND any child's `upline` that points to it with the real ID once they join.
// `node check-teams.js` will (correctly) warn about every NJ_ id until then.
// ─────────────────────────────────────────────────────────────────────────────

  // ═══ Masters / Base Shops ═══
  '1488993382234849281': { name: 'Edgar Navarrete',  upline: 'OVERALL_AGENCY',      baseShop: true, master: true },
  '1050860426994401310': { name: 'Travis Blackburn', upline: '1488993382234849281', baseShop: true, master: true },

  // ═══ Under Travis Blackburn ═══
  'NJ_PATRICK_DAMMERT':       { name: 'Patrick Dammert',       upline: '1050860426994401310', baseShop: false },
  'NJ_JOAQUIN_TARTARA':       { name: 'Joaquin Tartara',       upline: 'NJ_PATRICK_DAMMERT',  baseShop: false },
  'NJ_GEORGE_NORDELO':        { name: 'George Nordelo',        upline: '1050860426994401310', baseShop: false },
  'NJ_EGOR_VASILEVSKIY':      { name: 'Egor Vasilevskiy',      upline: 'NJ_GEORGE_NORDELO',   baseShop: false },
  'NJ_GABRIEL_PEARSON':       { name: 'Gabriel Pearson',       upline: 'NJ_GEORGE_NORDELO',   baseShop: false },
  '534435409678041089':       { name: 'Luca Host',             upline: 'NJ_GABRIEL_PEARSON',  baseShop: false },
  'NJ_ABIMAEL_CORREA_PATXOT': { name: 'Abimael Correa-Patxot', upline: 'NJ_GABRIEL_PEARSON',  baseShop: false },
  '299698780159082496':       { name: 'Ronald Gozo',           upline: 'NJ_GEORGE_NORDELO',   baseShop: false },
  'NJ_TRYSHA_NORDELO':        { name: 'Trysha Nordelo',        upline: 'NJ_GEORGE_NORDELO',   baseShop: false },
  '308404068110565388':       { name: 'Howard Lebright',       upline: '1050860426994401310', baseShop: false },
  '1489026705803837510':      { name: 'Kai Beck',              upline: '1050860426994401310', baseShop: false },
  '541438015176835092':       { name: 'Jamael Rahill',         upline: '1489026705803837510', baseShop: false },
  'NJ_TIEGEN_JENSEN':         { name: 'Tiegen Jensen',         upline: '1489026705803837510', baseShop: false },
  '432394535394344961':       { name: 'Brandon Harris',        upline: '1050860426994401310', baseShop: false },
  'NJ_JACOB_LEVIN':           { name: 'Jacob Levin',           upline: '432394535394344961',  baseShop: false },
  '921935722607435797':       { name: 'Lucas Spaneir',         upline: '432394535394344961',  baseShop: false },
  'NJ_JACOB_BURNIEWICZ':      { name: 'Jacob Burniewicz',      upline: '1050860426994401310', baseShop: false },
  'NJ_STEPHEN_MORRISSEY':     { name: 'Stephen Morrissey',     upline: 'NJ_JACOB_BURNIEWICZ', baseShop: false },
  'NJ_ISAIAS_ALARCON':        { name: 'Isaias Alarcon',        upline: 'NJ_JACOB_BURNIEWICZ', baseShop: false },
  '1489004031358799892':      { name: 'Craig Laymon',          upline: '1050860426994401310', baseShop: false },
  'NJ_LIA_LAYMON':            { name: 'Lia Laymon',            upline: '1489004031358799892', baseShop: false },
  '1150137116349702325':      { name: 'Jon Weir',              upline: '1050860426994401310', baseShop: false },
  '1488996815482261534':      { name: 'Joseph Asmann',         upline: '1150137116349702325', baseShop: false },
  'NJ_LIANA_GARCIA':          { name: 'Liana Garcia',          upline: '1488996815482261534', baseShop: false },
  'NJ_JACOB_LEIMBACH':        { name: 'Jacob Leimbach',        upline: '1150137116349702325', baseShop: false },
  '1168425073439420457':      { name: 'Taj Lewis',             upline: '1050860426994401310', baseShop: false },
  'NJ_ISIAH_BELTON':          { name: 'Isiah Belton',          upline: '1168425073439420457', baseShop: false },
  'NJ_JEFFREY_ROBERTS':       { name: 'Jeffrey Roberts',       upline: '1050860426994401310', baseShop: false },
  '1206855921779744809':      { name: 'Joseph Rowe',           upline: '1050860426994401310', baseShop: false },
  'NJ_BRENNAN_PRESTON':       { name: 'Brennan Preston',       upline: '1206855921779744809', baseShop: false },
  'NJ_DANIEL_BOYNTON':        { name: 'Daniel Boynton',        upline: '1050860426994401310', baseShop: false },
  'NJ_JASON_BROWN':           { name: 'Jason Brown',           upline: 'NJ_DANIEL_BOYNTON',   baseShop: false },
  '1471280728682528768':      { name: 'Brandon Williams',      upline: '1050860426994401310', baseShop: false },
  'NJ_COLTON_KENTOPP':        { name: 'Colton Kentopp',        upline: '1050860426994401310', baseShop: false },
  '501884589414023179':       { name: 'Garret Rodenberger',    upline: '1050860426994401310', baseShop: false },
  'NJ_YADITA_JELEN':          { name: 'Yadita Jelen',          upline: '1050860426994401310', baseShop: false },
  'NJ_MICHAEL_NELSON':        { name: 'Michael Nelson',        upline: 'NJ_YADITA_JELEN',     baseShop: false },
  'NJ_JUSTIN_STEWART':        { name: 'Justin Stewart',        upline: '1050860426994401310', baseShop: false },
  'NJ_SHANE_DEDRICK':         { name: 'Shane Dedrick',         upline: '1050860426994401310', baseShop: false },
  'NJ_STEPHEN_STEELE':        { name: 'Stephen Steele',        upline: '1050860426994401310', baseShop: false },

  // ═══ Under Edgar Navarrete (direct) ═══
  '748752963358425098':       { name: 'Brian McDaniel',        upline: '1488993382234849281', baseShop: false },
  'NJ_BRANDYN_JAMES':         { name: 'Brandyn James',         upline: '748752963358425098',  baseShop: false },
  'NJ_DILLON_WHITEHEAD':      { name: 'Dillon Whitehead',      upline: '748752963358425098',  baseShop: false },
  '696435335244283994':       { name: 'Jonathan Perez',        upline: '1488993382234849281', baseShop: false },
  '454871522608152587':       { name: 'James Legacie',         upline: '1488993382234849281', baseShop: false },
  '1488973836996055262':      { name: 'Gene Hendrickson',      upline: '1488993382234849281', baseShop: false },
  '1506673490395140176':      { name: 'Mario Dominguez',       upline: '1488993382234849281', baseShop: false },
  'NJ_DREW_DEAL':             { name: 'Drew Deal',             upline: '1488993382234849281', baseShop: false },
  'NJ_JAKE_JACKSON':          { name: 'Jake Jackson',          upline: '1488993382234849281', baseShop: false },
  'NJ_DENIS_BARYSHNIKOV':     { name: 'Denis Baryshnikov',     upline: 'NJ_JAKE_JACKSON',     baseShop: false },
  'NJ_BAYLEY_PORRECA':        { name: 'Bayley Porreca',        upline: 'NJ_JAKE_JACKSON',     baseShop: false },
  'NJ_JACK_NIELSEN':          { name: 'Jack Nielsen',          upline: 'NJ_JAKE_JACKSON',     baseShop: false },
  'NJ_LAWTON_DENIS':          { name: 'Lawton Denis',          upline: 'NJ_JAKE_JACKSON',     baseShop: false },
  'NJ_BRONSON_KIBLER':        { name: 'Bronson Kibler',        upline: '1488993382234849281', baseShop: false },
  'NJ_ANGELA_POULSON':        { name: 'Angela Poulson',        upline: 'NJ_BRONSON_KIBLER',   baseShop: false },
  '1433812381586161755':      { name: 'Amani Alshaibi',        upline: 'NJ_ANGELA_POULSON',   baseShop: false },
  'NJ_KATELYN_COSTA':         { name: 'Katelyn Costa',         upline: 'NJ_ANGELA_POULSON',   baseShop: false },
