import WindowBorderFrame from '../ui/WindowBorderFrame.jsx'
import WindowTitleBar from '../ui/WindowTitleBar.jsx'

// Standalone help window for the importer. Explains the scan scheme / regex
// system in detail with concrete examples. Opened from the importer's
// "Help & Examples" button (open-importer-help IPC).

function Mono({ children }) {
  return <span className="font-mono bg-primary px-1 py-0.5 rounded text-[12px]">{children}</span>
}

function Section({ title, children }) {
  return (
    <section className="space-y-2">
      <h2 className="text-base font-semibold text-text border-b border-border pb-1">{title}</h2>
      <div className="space-y-2 text-sm text-text leading-relaxed">{children}</div>
    </section>
  )
}

function ExampleRow({ scheme, folder, parses }) {
  return (
    <tr className="border-t border-border align-top">
      <td className="px-3 py-2"><Mono>{scheme}</Mono></td>
      <td className="px-3 py-2"><Mono>{folder}</Mono></td>
      <td className="px-3 py-2 text-muted">{parses}</td>
    </tr>
  )
}

export default function ImporterHelp() {
  return (
    <div className="flex flex-col h-screen font-sans text-[13px] bg-secondary text-text rounded-windowTheme overflow-hidden transform-gpu">
      <WindowBorderFrame />
      <WindowTitleBar title="Importer Help & Examples" />
      <div className="flex-1 min-h-0 overflow-y-auto scroll-window-inset p-6 space-y-6 max-w-3xl">
        <Section title="How importing works">
          <p>
            The importer scans a folder you choose, reads each game's folder (or archive) name, and tries to
            pull out the <strong>Title</strong>, <strong>Creator</strong>, <strong>Version</strong>, and (optionally)
            an <strong>Engine</strong> or a site ID. It then matches each result against the catalog so metadata,
            banners, and previews can be attached.
          </p>
          <p>
            The accuracy of that parse depends entirely on the <strong>Scan Scheme</strong> you pick — it should
            describe how your folders are actually named.
          </p>
        </Section>

        <Section title="Scan schemes">
          <p>
            A scheme is a small template built from <em>tokens</em> in braces, separated by literal characters
            (usually <Mono>/</Mono> for nested folders, or spaces, dashes, brackets). Supported tokens:
          </p>
          <ul className="list-disc pl-5 space-y-1">
            <li><Mono>{'{title}'}</Mono> — the game title</li>
            <li><Mono>{'{creator}'}</Mono> — the developer/creator</li>
            <li><Mono>{'{version}'}</Mono> — the version string (e.g. <Mono>v1.2.3</Mono>)</li>
            <li><Mono>{'{engine}'}</Mono> — the engine (Ren'Py, RPGM, Unity, …)</li>
            <li><Mono>{'{f95Id}'}</Mono> — the F95zone thread ID</li>
            <li><Mono>{'{lcId}'}</Mono> — the LewdCorner ID</li>
          </ul>
          <p>
            Tokens can sit at different folder levels. For example <Mono>{'{creator}/{title}/{version}'}</Mono>
            expects a top folder per creator, a subfolder per game, and a version folder inside that.
          </p>
        </Section>

        <Section title="Examples">
          <div className="border border-border rounded overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-primary text-muted">
                <tr>
                  <th className="text-left font-medium px-3 py-2">Scheme</th>
                  <th className="text-left font-medium px-3 py-2">Folder</th>
                  <th className="text-left font-medium px-3 py-2">Parses as</th>
                </tr>
              </thead>
              <tbody>
                <ExampleRow scheme="{creator}/{title}/{version}" folder="DevName/My Game/v1.2" parses="Creator = DevName, Title = My Game, Version = v1.2" />
                <ExampleRow scheme="{title}/{version}" folder="My Game/0.9.5" parses="Title = My Game, Version = 0.9.5" />
                <ExampleRow scheme="{creator}/{title} - {version}" folder="DevName/My Game - v1.2" parses="Creator = DevName, Title = My Game, Version = v1.2" />
                <ExampleRow scheme="[{engine}] [{title}] [{version}]" folder="[RenPy] [My Game] [v1.2]" parses="Engine = RenPy, Title = My Game, Version = v1.2" />
                <ExampleRow scheme="{f95Id}/{creator}/{title}/{version}" folder="12345/DevName/My Game/v1.2" parses="F95 ID = 12345, Creator = DevName, Title = My Game, Version = v1.2" />
                <ExampleRow scheme="{engine} - {status} - {title}[{version}][{creator}]" folder="RenPy - Ongoing - My Game[v1.2][DevName]" parses="Engine = RenPy, Title = My Game, Version = v1.2, Creator = DevName" />
              </tbody>
            </table>
          </div>
        </Section>

        <Section title="Editing the regex directly">
          <p>
            The <strong>Folder Regex</strong> field shows the pattern generated from your scheme. Most people never
            need to touch it. If your naming is irregular, enable <strong>Edit regex</strong> and supply your own
            pattern using <em>named capture groups</em>:
          </p>
          <p><Mono>{'(?<creator>.+?)/(?<title>.+?)/(?<version>.+)'}</Mono></p>
          <p>
            Group names must match the token names (<Mono>title</Mono>, <Mono>creator</Mono>, <Mono>version</Mono>,
            <Mono>engine</Mono>, <Mono>f95Id</Mono>, <Mono>lcId</Mono>). Anything the regex doesn't capture is left
            blank on the row and can be matched or filled in before importing.
          </p>
        </Section>

        <Section title="Tips">
          <ul className="list-disc pl-5 space-y-1">
            <li>Use the <strong>live preview</strong> on the settings screen — it parses your first folder so you can confirm the scheme before scanning.</li>
            <li>Blank fields are fine. Rows import even if the parse is imperfect; you can edit Title/Creator/Version in the scan table, or match against the catalog to fill them.</li>
            <li>If lots of rows look wrong, the scheme probably doesn't match your folder layout — adjust it and re-scan.</li>
            <li>Turn on <strong>Include archives</strong> to scan <Mono>.zip</Mono>/<Mono>.7z</Mono>/<Mono>.rar</Mono> files alongside folders.</li>
          </ul>
        </Section>
      </div>
    </div>
  )
}
