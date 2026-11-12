// Facebook reseller groups we post in. `code` is the short code used in links
// (qrate-go.up.railway.app/<code>/<link>); never reuse or change a code once
// posted, or old links stop being attributed to the right group.
export const FB_GROUPS = [
  { code: "f1",  id: "814679469369169",  name: "Online Resellers & Manufactures Group" },
  { code: "f2",  id: "858664978373562",  name: "Avaasa and non branded Kurtis online shopping" },
  { code: "f3",  id: "442642397099031",  name: "Cotton Sarees Manufacturer" },
  { code: "f4",  id: "510877313410337",  name: "reseller direct dealer" },
  { code: "f5",  id: "516565522881291",  name: "Branded Kurtis (Avaasa and fusion)" },
  { code: "f6",  id: "3255855754500156", name: "Reselling group" },
  { code: "f7",  id: "8243042472412571", name: "The Reseller Community" },
  { code: "f8",  id: "421220022231114",  name: "manufacturers and Resellers group" },
  { code: "f9",  id: "979051810497917",  name: "SURPLUS BANGALORE" },
  { code: "f10", id: "647540728711263",  name: "Kurtis Manufacturer" },
  { code: "f11", id: "premiumreseller",  name: "Premium Reseller" },
  { code: "f12", id: "461481438240912",  name: "RESELLERS OF INDIA BUY SELL GROUP" },
  { code: "f13", id: "onlineshoppinginkolkata", name: "Online Shopping Kolkata" },
  { code: "f14", id: "2284342278455312", name: "whatsapp resellers for jewels and clothings" },
  { code: "f15", id: "131304940952923",  name: "Buy ,n, Sell In Bangalore" },
  { code: "f16", id: "305341403001635",  name: "Resellers and buyers india" },
  { code: "f17", id: "238649441007511",  name: "Resellers group" },
  { code: "f18", id: "339085890940442",  name: "Reselling group" },
  { code: "f19", id: "626497371322039",  name: "Reselling House" },
  { code: "f20", id: "224178984678180",  name: "Manufacturers, Wholesalers and Resellers Only" },
  { code: "f21", id: "962878377895073",  name: "Resellers hub" },
  { code: "f22", id: "5112184372173472", name: "go colour and Avasa leggings" },
];

export const getFbGroup = (code) => FB_GROUPS.find((g) => g.code === code);
