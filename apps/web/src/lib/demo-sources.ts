const root = "/demo/sources/";

export const demoSources: Record<string, { title: string; text: string }> = {
  "contoso-sre-jobs": { title: "Contoso Pay careers", text: "(sample data) Hiring 3 Site Reliability Engineers." },
  "contoso-series-b": { title: "Contoso Pay funding update", text: "(sample data) Raised a $40M Series B." },
  "fabrikam-renewal": { title: "Fabrikam Data technology update", text: "(sample data) Plans to replace TraceHound at renewal." },
  "jordan-profile": { title: "Jordan Lee's profile", text: "Fictional fixture: Jordan Lee previously worked at Fabrikam Data before joining Contoso Pay." },
  "sam-profile": { title: "Sam Rivera's profile", text: "Fictional fixture: Sam Rivera previously worked at Fabrikam Data before joining Northwind Cloud." },
  "jordan-lee": { title: "Jordan Lee at Contoso Pay", text: "Fictional fixture: Jordan Lee is VP Engineering at Contoso Pay." },
  "sam-rivera": { title: "Sam Rivera at Northwind Cloud", text: "Fictional fixture: Sam Rivera is Staff SRE at Northwind Cloud." },
  "avery-chen": { title: "Avery Chen at Fabrikam Data", text: "Fictional fixture: Avery Chen is Head of Platform at Fabrikam Data." },
  "riley-patel": { title: "Riley Patel at Tailspin Apps", text: "Fictional fixture: Riley Patel is CTO at Tailspin Apps." },
};

export function displaySourceUrl(url: string) {
  const key = url.startsWith("https://news.example/") ? url.slice("https://news.example/".length) : "";
  return Object.hasOwn(demoSources, key) ? `${root}${key}` : url;
}
