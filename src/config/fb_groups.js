// Facebook reseller groups we post in. `code` is the short code used in links
// (qrate-go.up.railway.app/<code>/<link>); never reuse or change a code once
// posted, or old links stop being attributed to the right group.
// theme picks which topics the group gets (see fb_planner.js).
// active: false = we no longer post there (kept so its old links still work).
export const FB_GROUPS = [
  { code: "f1",  id: "814679469369169",  name: "Online Resellers & Manufactures Group", theme: "general" },
  { code: "f2",  id: "858664978373562",  name: "Avaasa and non branded Kurtis online shopping", theme: "kurtis" },
  { code: "f3",  id: "442642397099031",  name: "Cotton Sarees Manufacturer", theme: "sarees" },
  { code: "f4",  id: "510877313410337",  name: "reseller direct dealer", theme: "general" },
  { code: "f5",  id: "516565522881291",  name: "Branded Kurtis (Avaasa and fusion)", theme: "kurtis" },
  { code: "f6",  id: "3255855754500156", name: "Reselling group", theme: "general" },
  { code: "f7",  id: "8243042472412571", name: "The Reseller Community", theme: "general" },
  { code: "f8",  id: "421220022231114",  name: "manufacturers and Resellers group", theme: "general" },
  { code: "f9",  id: "979051810497917",  name: "SURPLUS BANGALORE", theme: "general" },
  { code: "f10", id: "647540728711263",  name: "Kurtis Manufacturer", theme: "kurtis" },
  { code: "f11", id: "premiumreseller",  name: "Premium Reseller", theme: "general" },
  { code: "f12", id: "461481438240912",  name: "RESELLERS OF INDIA BUY SELL GROUP", theme: "general" },
  { code: "f13", id: "onlineshoppinginkolkata", name: "Online Shopping Kolkata", theme: "general", active: false }, // marketplace listings only
  { code: "f14", id: "2284342278455312", name: "whatsapp resellers for jewels and clothings", theme: "general" },
  { code: "f15", id: "131304940952923",  name: "Buy ,n, Sell In Bangalore", theme: "general" },
  { code: "f16", id: "305341403001635",  name: "Resellers and buyers india", theme: "general" },
  { code: "f17", id: "238649441007511",  name: "Resellers group", theme: "general" },
  { code: "f18", id: "339085890940442",  name: "Reselling group", theme: "general" },
  { code: "f19", id: "626497371322039",  name: "Reselling House", theme: "general", active: false }, // marketplace listings only
  { code: "f20", id: "224178984678180",  name: "Manufacturers, Wholesalers and Resellers Only", theme: "general" },
  { code: "f21", id: "962878377895073",  name: "Resellers hub", theme: "general" },
  { code: "f22", id: "5112184372173472", name: "go colour and Avasa leggings", theme: "kurtis" },
  { code: "f23", id: "2395670717416905", name: "Kolkata Online Shopping", theme: "general" },
  { code: "f24", id: "282697080218846",  name: "Resellers group", theme: "general" },
];

export const getFbGroup = (code) => FB_GROUPS.find((g) => g.code === code);
