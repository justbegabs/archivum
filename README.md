# Entrelinhas

Um quadro visual de anotações que funciona diretamente no navegador. Abra `index.html` para começar, ou sirva a pasta com um servidor HTTP local.

- Use a barra inferior para criar notas, lembretes e títulos.
- Use **T** para adicionar um texto independente. Selecione trechos para aplicar negrito, itálico, sublinhado, cor e tamanho na barra de formatação.
- Use o ícone de imagem para anexar imagens PNG, JPEG, GIF ou WebP de até 20 MB cada. O espaço disponível depende do armazenamento do navegador.
- Use o clipe para anexar documentos PDF, Word, OpenDocument, texto, planilhas ou apresentações; use o ícone de vídeo para MP4, WebM ou MOV. Cada documento ou vídeo pode ter até 100 MB, conforme o espaço disponível. Vídeos podem ser reproduzidos no quadro quando o navegador suporta seu formato e codec; todos os anexos podem ser baixados.
- Alterne entre os temas claro e escuro pelo botão no cabeçalho; a preferência fica salva neste dispositivo.
- Arraste as bordas de uma nota para movê-la. Clique no texto para editá-lo.
- As alterações são salvas localmente ao editar. Com a conta conectada, uma pausa de um segundo inicia a sincronização mesmo com o cursor no campo; sair do campo antecipa a tentativa. A edição continua ativa enquanto você usa a barra de formatação. Alterações recebidas da nuvem que substituiriam um quadro são aplicadas depois de sair do campo.
- Selecione a ferramenta de seta e clique em duas notas para conectá-las.
- Use o ícone de pasta para criar uma pasta dentro do quadro. Edite o nome, clique em **Abrir pasta** e adicione notas, imagens ou outras pastas em um espaço separado. Use **Voltar** para retornar. Excluir uma pasta apaga também seu conteúdo.
- Use a ferramenta de mão para mover o quadro e os controles no canto inferior para ajustar a visualização.
- Na ferramenta de seleção, arraste uma área vazia com o mouse para selecionar vários itens e arraste um deles para mover o grupo. No celular, use **Selecionar uma área** para selecionar e depois volte para **Selecionar** para mover o grupo; a ferramenta de mão continua disponível para navegar. Use a lixeira para excluir a seleção, com confirmação quando houver vários itens.
- Use **Adicionar forma geométrica**, escolha retângulo, elipse ou triângulo e uma cor, e arraste no quadro para criar a forma. As formas ficam atrás dos demais itens; selecione uma forma para movê-la ou redimensioná-la pelo canto inferior direito.
- Use **Desenhar à mão livre** para criar traços com caneta, marcador ou tracejado, escolhendo cor e espessura. Os desenhos podem ser selecionados, movidos e excluídos como outros itens e são salvos e exportados com o quadro.
- No celular, arraste uma área vazia para navegar pelo quadro sem reduzir o texto; use o botão de centralizar para visualizar todas as notas.
- Crie outros quadros na barra lateral. O botão de download exporta o quadro atual em JSON.
- Clique em **entrelinhas** para acessar todos os quadros e adicionar ou alterar a imagem de capa de cada um.
- Na página inicial, use **Excluir quadro** e confirme para removê-lo. Sem login, a exclusão do quadro não pode ser desfeita; faça um backup antes. Com login, uma versão é arquivada localmente e pode ser restaurada como cópia. O backup dos dados anteriores ao login inclui capas e anexos do IndexedDB antigo, mesmo sem referência.
- **Backup local anterior** baixa um JSON com os quadros anteriores ao login e os arquivos do IndexedDB antigo, inclusive os sem referência. Ele não inclui os dados armazenados por conta. Não há restauração automática desse JSON; para a conta conectada, use as opções abaixo.

O backup contém dados privados em texto e anexos codificados em base64; guarde-o em local seguro. Arquivos grandes podem exigir bastante memória e espaço. Imagens que existem apenas como links externos permanecem como links; o conteúdo externo não é baixado. O backup preserva o texto original de `entrelinhas-boards-v1`, bem como identificadores, tipos, nomes, tamanhos, datas e hashes dos arquivos locais.

Sem login, os quadros permanecem no armazenamento local antigo. Com login, o editor usa um armazenamento separado por conta e tenta sincronizá-lo com o Supabase. Limpar os dados do navegador pode apagar rascunhos ainda não enviados. Não há importação do JSON exportado. A fonte e a imagem do quadro de exemplo são carregadas da internet quando disponíveis.

## Preparação do Supabase

**Compartilhamento seguro ainda não está disponível.** O esquema antigo abaixo
concede acesso de editor a um e-mail confirmado assim que ele é adicionado,
sem aceite por link, expiração ou opção de visualizador. Não o utilize como
implementação dos novos requisitos de compartilhamento. A substituição desse
modelo deverá exigir novos convites também para os acessos antigos, conforme
solicitado, e será apresentada para revisão antes de qualquer execução.

O arquivo legado [supabase-setup.sql](supabase-setup.sql) prepara tabelas, convites por e-mail confirmado, regras de acesso, um bucket privado e notificações de alterações. Ele não deve ser executado para habilitar o novo compartilhamento seguro. O script interrompe a operação se o bucket existente for público. Os limites de upload dependem também da configuração e do plano do Supabase.

O esquema legado não implementa a sincronização privada atual nem envia e-mails. Não use a chave secreta ou `service_role` no navegador.

O botão **Entrar com Google** inicia a autenticação no projeto Supabase configurado; **Sair** encerra a sessão. Abra o site por HTTP(S) e autorize o endereço completo em Authentication → URL Configuration. O SDK é carregado pela internet. A migração [202611080001_owner_board_delete.sql](migrations/202611080001_owner_board_delete.sql) pertence ao esquema legado e não é executada automaticamente.

Na página inicial, **Verificar dados locais** informa o número de quadros, arquivos referenciados, arquivos disponíveis e arquivos sem referência, além de alertar sobre referências ausentes. A verificação é somente leitura.

## Colaboração em tempo real

A colaboração simultânea entre usuários ainda não está implementada. A
sincronização privada usa consultas periódicas, não Realtime nem edição
colaborativa de texto.

Para edição simultânea do mesmo campo de texto, uma substituição do HTML
completo não permite mesclar alterações concorrentes com segurança. Um CRDT
como Yjs deve ser avaliado junto com um editor de texto compatível, incluindo
formatação, persistência de operações offline, reconexão e permissões. Até essa
integração ser validada, edições concorrentes no mesmo campo devem ser
tratadas como conflito explícito, preservando as duas versões, em vez de
selecionar silenciosamente a última gravação.

O compartilhamento seguro e permissões de colaborador continuam fora do escopo.

Como preparação para a sincronização entre dispositivos, a migração
[202611080002_private_sync_foundation.sql](migrations/202611080002_private_sync_foundation.sql)
propõe tabelas separadas para quadros privados, histórico de revisões e
objetos imutáveis em um bucket privado por proprietário. A função de gravação
recusa uma revisão desatualizada. Ela não usa os convites do esquema legado.
Os testes em PostgreSQL isolado usam esquemas simulados de Auth e Storage:
verificam revisão, histórico transacional, restrições por proprietário e
rejeição de bucket público. No projeto Supabase configurado, essa estrutura foi
aplicada após a revisão das políticas existentes de
`storage.objects`. Uma consulta confirmou as tabelas com RLS, a função, o bucket
privado e as duas políticas de arquivos. Isso não substitui testes reais de
acesso entre contas: uma política permissiva adicional pode conceder acesso
indevido. A migração cria objetos novos e não deve ser executada novamente
no mesmo projeto.

Para repetir o teste SQL isolado, instale `@electric-sql/pglite` em um diretório
de testes separado e defina a variável `PGLITE_PACKAGE_DIR` para o caminho
absoluto do pacote instalado. Depois execute
`node --test tests\sync-migration.postgres.test.js`. O teste cria um banco
descartável em memória e não se conecta ao Supabase.

O botão **Enviar cópia dos quadros** gera um backup local e pede confirmação
após conferência. Ele usa
[sync-import-core.js](sync-import-core.js) para enviar quadros locais e seus
arquivos referenciados após confirmação. Ele compara os dados locais,
verifica os bytes no Storage e não sobrescreve uma cópia remota diferente.
Arquivos sem referência continuam somente no dispositivo. Uma falha pode deixar
objetos ou quadros parciais na nuvem; uma tentativa idêntica pode ser retomada.
Os testes de envio usam serviços simulados; o acesso com contas reais ainda
precisa ser validado no Supabase real. Abra o site na mesma origem e navegador
dos dados originais; `localhost` e GitHub Pages não compartilham armazenamento.

**Consultar cópias na nuvem** lista cópias já enviadas para a conta conectada e
permite visualizar seu JSON e baixar os arquivos verificados. Essa consulta é
somente leitura: não abre o quadro no editor, não sincroniza alterações e exige
o esquema no Supabase. Ela não altera os dados do navegador.

O editor utiliza [sync-reconcile.js](sync-reconcile.js) e
[sync-engine.js](sync-engine.js) para comparar revisões, verificar anexos e
sincronizar alterações após edição, reconexão e consulta periódica. A exclusão
é lógica e preserva documento e arquivos. Na página inicial, conflitos podem
ser comparados em JSON e resolvidos com a versão local, a remota ou ambas.
Versões anteriores são arquivadas no IndexedDB da conta e podem ser
restauradas como cópias na página inicial. Quando um identificador de anexo
representa conteúdos diferentes, baixe as duas versões para compará-las e
selecione a versão a usar em cada anexo antes de escolher o quadro. As duas
versões dos arquivos são preservadas localmente com identificadores distintos;
a versão não escolhida permanece vinculada ao quadro arquivado.

## Backup da conta Google

Na página inicial, com a conta conectada, **Exportar backup da conta** reúne
quadros locais, bases de revisão, versões arquivadas, rascunhos pendentes,
todos os arquivos locais da conta (inclusive sem referência) e versões atuais
dos quadros remotos com seus anexos. Quadros e anexos incluem posições,
formatação, pastas, conexões e metadados. A exportação consulta o Supabase e
verifica revisões, referências e hashes SHA-256; se a conta mudar, a rede falhar,
um arquivo estiver ausente ou os dados mudarem durante a leitura, ela é
interrompida. Feche outras abas e evite editar durante a operação.

**Restaurar backup como cópias** verifica a integridade e exige a mesma conta.
Quadros ativos recebem novos identificadores e aparecem no editor; versões
arquivadas, bases e rascunhos ficam em **Versões arquivadas** e podem ser
restaurados como novos quadros. Uma versão encontrada somente na nuvem também
aparece como cópia; uma versão remota alternativa fica arquivada. As cópias
ativas serão sincronizadas; as versões arquivadas permanecem apenas neste
navegador até serem restauradas como quadro. A restauração não aplica revisões
antigas, não substitui arquivos ou quadros existentes e não altera a conta de
origem. Uma interrupção pode deixar arquivos sem referência no armazenamento
local, sem remover os dados anteriores.

O backup contém dados privados em texto e anexos em base64; não é criptografado.
Guarde-o em local seguro e não restaure arquivos de origem desconhecida: hashes
detectam alterações acidentais, mas não autenticam o arquivo. JSON e base64
podem exigir muita memória e espaço. Links externos continuam como links.
O backup não inclui o histórico de revisões mantido exclusivamente no servidor,
objetos do Storage sem referência nos quadros atuais, dados ainda não enviados
por outros dispositivos nem os dados locais anteriores ao login. A leitura de
vários quadros não é uma transação global no Supabase; alterações remotas após
a última verificação não entram no arquivo. Para dados antigos deste navegador,
baixe separadamente **Backup local anterior**.

Os dados da conta ficam em IndexedDB, com rascunhos temporários em localStorage.
Se uma edição ocorrer durante uma sincronização ou houver conflito entre abas,
o editor pode bloquear a sincronização e oferecer recuperação do rascunho como
cópias: feche as outras abas antes de usá-la. Os testes do editor usam serviços
simulados; login, políticas, transferência de arquivos e sincronização entre
dispositivos ainda devem ser validados no Supabase real antes de depender deles.
Os arquivos desta alteração ainda precisam ser publicados no GitHub Pages.

### Diagnóstico entre dispositivos

Na página inicial, abra **Diagnóstico de sincronização** e use **Verificar agora**
em cada dispositivo. A verificação consulta quadros e anexos sem gravar ou
substituir dados. Compare a versão e a impressão da conta; impressões iguais
sugerem a mesma conta, mas não substituem a verificação completa do identificador
do Supabase. Compare os identificadores abreviados dos quadros e a revisão remota.
A revisão comum é a última versão remota reconhecida localmente; mudanças locais
pendentes não possuem revisão remota. Conflitos e atualizações adiadas durante
edição são indicados separadamente. Horários e contagem de tentativas são apenas
da sessão atual; a ausência de uma sincronização bem-sucedida não prova que nunca
houve sincronização. A próxima tentativa pode ser adiada por edição, rede ou pelo
navegador em segundo plano.

As mensagens de diagnóstico no console mostram somente etapas, sem conteúdo ou
tokens. A impressão da conta e identificadores abreviados aparecem apenas no
painel local: trate-os como dados privados. A consulta verifica os anexos
referenciados, mas não prova que uma edição específica foi enviada; compare as
revisões antes e depois de uma alteração. Erros são classificados de forma geral,
e falhas de rede, autorização, RLS e Storage podem exigir investigação adicional.
