# Entrelinhas

Um quadro visual de anotações que funciona diretamente no navegador. Abra `index.html` para começar, ou sirva a pasta com um servidor HTTP local.

- Use a barra inferior para criar notas, lembretes e títulos.
- Use **T** para adicionar um texto independente. Selecione trechos para aplicar negrito, itálico, sublinhado, cor e tamanho na barra de formatação.
- Use o ícone de imagem para anexar imagens PNG, JPEG, GIF ou WebP de até 20 MB cada. O espaço disponível depende do armazenamento do navegador.
- Use o clipe para anexar documentos PDF, Word, OpenDocument, texto, planilhas ou apresentações; use o ícone de vídeo para MP4, WebM ou MOV. Cada documento ou vídeo pode ter até 100 MB, conforme o espaço disponível. Vídeos podem ser reproduzidos no quadro quando o navegador suporta seu formato e codec; todos os anexos podem ser baixados.
- Alterne entre os temas claro e escuro pelo botão no cabeçalho; a preferência fica salva neste dispositivo.
- Arraste as bordas de uma nota para movê-la. Clique no texto para editá-lo.
- Selecione a ferramenta de seta e clique em duas notas para conectá-las.
- Use o ícone de pasta para criar uma pasta dentro do quadro. Edite o nome, clique em **Abrir pasta** e adicione notas, imagens ou outras pastas em um espaço separado. Use **Voltar** para retornar. Excluir uma pasta apaga também seu conteúdo.
- Use a ferramenta de mão para mover o quadro e os controles no canto inferior para ajustar a visualização.
- Na ferramenta de seleção, arraste uma área vazia com o mouse para selecionar vários itens e arraste um deles para mover o grupo. No celular, use **Selecionar uma área** para selecionar e depois volte para **Selecionar** para mover o grupo; a ferramenta de mão continua disponível para navegar. Use a lixeira para excluir a seleção, com confirmação quando houver vários itens.
- Use **Adicionar forma geométrica**, escolha retângulo, elipse ou triângulo e uma cor, e arraste no quadro para criar a forma. As formas ficam atrás dos demais itens; selecione uma forma para movê-la ou redimensioná-la pelo canto inferior direito.
- Use **Desenhar à mão livre** para criar traços com caneta, marcador ou tracejado, escolhendo cor e espessura. Os desenhos podem ser selecionados, movidos e excluídos como outros itens e são salvos e exportados com o quadro.
- No celular, arraste uma área vazia para navegar pelo quadro sem reduzir o texto; use o botão de centralizar para visualizar todas as notas.
- Crie outros quadros na barra lateral. O botão de download exporta o quadro atual em JSON.
- Clique em **entrelinhas** para acessar todos os quadros e adicionar ou alterar a imagem de capa de cada um.
- Na página inicial, use **Excluir quadro** e confirme para remover um quadro e seu conteúdo deste navegador. A exclusão não pode ser desfeita; faça um backup antes. Capas e anexos permanecem no IndexedDB e continuam incluídos no backup completo, mesmo sem referência.
- Antes de migrar, use **Backup completo** para baixar um JSON com o estado original e todos os arquivos do IndexedDB, incluindo arquivos sem referência. Abra o site na mesma origem e navegador em que os dados foram criados; `localhost` e GitHub Pages não compartilham armazenamento. Feche outras abas e não edite enquanto o backup é gerado. Confira o download e os eventuais alertas de arquivos ausentes. Não há restauração automática implementada.

O backup contém dados privados em texto e anexos codificados em base64; guarde-o em local seguro. Arquivos grandes podem exigir bastante memória e espaço. Imagens que existem apenas como links externos permanecem como links; o conteúdo externo não é baixado. O backup preserva o texto original de `entrelinhas-boards-v1`, bem como identificadores, tipos, nomes, tamanhos, datas e hashes dos arquivos locais.

Os quadros são salvos no armazenamento local do navegador e os arquivos anexados no IndexedDB, neste dispositivo. Limpar os dados do navegador pode apagá-los; não há sincronização entre dispositivos nem importação do JSON exportado. O arquivo exportado inclui os anexos e a capa, inclusive dentro das pastas; vídeos grandes podem gerar arquivos JSON muito grandes. A fonte e a imagem do quadro de exemplo são carregadas da internet quando disponíveis.

## Preparação do Supabase

**Compartilhamento seguro ainda não está disponível.** O esquema antigo abaixo
concede acesso de editor a um e-mail confirmado assim que ele é adicionado,
sem aceite por link, expiração ou opção de visualizador. Não o utilize como
implementação dos novos requisitos de compartilhamento. A substituição desse
modelo deverá exigir novos convites também para os acessos antigos, conforme
solicitado, e será apresentada para revisão antes de qualquer execução.

O arquivo legado [supabase-setup.sql](supabase-setup.sql) prepara tabelas, convites por e-mail confirmado, regras de acesso, um bucket privado e notificações de alterações. Ele não deve ser executado para habilitar o novo compartilhamento seguro. O script interrompe a operação se o bucket existente for público. Os limites de upload dependem também da configuração e do plano do Supabase.

Essa preparação **não integra os quadros à nuvem**: migração dos quadros locais, CRUD remoto, interface de convites, sincronização e tratamento de conflitos ainda precisam ser implementados. Convites são registros de permissão; o script não envia e-mails. A futura integração deve armazenar arquivos em `<id-do-quadro>/<nome-do-arquivo>`, usar `entrelinhas_save_board` com a revisão atual e tratar conflitos sem perder alterações. Não use a chave secreta ou `service_role` no navegador.

O botão **Entrar com Google** inicia a autenticação no projeto Supabase configurado; **Sair** encerra a sessão. Abra o site por HTTP(S) e autorize o endereço completo em Authentication → URL Configuration. A sessão usa o armazenamento do Supabase no navegador. A autenticação, por si só, **não envia nem sincroniza quadros**. O SDK é carregado pela internet. A migração [202611080001_owner_board_delete.sql](migrations/202611080001_owner_board_delete.sql) complementa o script anterior e não é executada automaticamente; a exclusão de objetos no Storage ainda precisa ser tratada pela futura integração.

Na página inicial, **Verificar dados locais** informa o número de quadros, arquivos referenciados, arquivos disponíveis e arquivos sem referência, além de alertar sobre referências ausentes. A verificação é somente leitura.

## Colaboração em tempo real

A colaboração em tempo real ainda não está implementada. O editor usa apenas
armazenamento local; a publicação Realtime e a função de revisão no script
legado, por si só, não conectam o editor nem fornecem o compartilhamento seguro.
Também não há fila offline de operações, histórico remoto ou resolução de
conflitos.

Para edição simultânea do mesmo campo de texto, uma substituição do HTML
completo não permite mesclar alterações concorrentes com segurança. Um CRDT
como Yjs deve ser avaliado junto com um editor de texto compatível, incluindo
formatação, persistência de operações offline, reconexão e permissões. Até essa
integração ser validada, edições concorrentes no mesmo campo devem ser
tratadas como conflito explícito, preservando as duas versões, em vez de
selecionar silenciosamente a última gravação.

A implementação depende primeiro de quadros e anexos na nuvem, migração
verificada sem apagar os dados locais e permissões de proprietário, editor e
visualizador efetivas também no Storage. Depois, será necessário persistir
rascunhos e alterações pendentes por usuário e quadro, comparar revisões no
servidor, recuperar alterações perdidas na reconexão e manter versões
recuperáveis. Nenhum desses mecanismos é ativado por este documento.

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
no mesmo projeto. O editor ainda não abre nem sincroniza os quadros remotos.

Para repetir o teste SQL isolado, instale `@electric-sql/pglite` em um diretório
de testes separado e defina a variável `PGLITE_PACKAGE_DIR` para o caminho
absoluto do pacote instalado. Depois execute
`node --test tests\sync-migration.postgres.test.js`. O teste cria um banco
descartável em memória e não se conecta ao Supabase.

O botão experimental **Enviar cópia dos quadros** usa
[sync-import-core.js](sync-import-core.js) para enviar quadros locais e seus
arquivos referenciados após confirmação. Ele compara os dados locais,
verifica os bytes no Storage e não sobrescreve uma cópia remota diferente.
Arquivos sem referência continuam somente no dispositivo. Uma falha pode deixar
objetos ou quadros parciais na nuvem; uma tentativa idêntica pode ser retomada.
Os testes de envio usam serviços simulados; o acesso com contas reais ainda
precisa ser validado antes do envio de dados. O botão não implementa abertura no
outro dispositivo, sincronização de edições ou resolução de conflitos.

**Consultar cópias na nuvem** lista cópias já enviadas para a conta conectada e
permite visualizar seu JSON e baixar os arquivos verificados. Essa consulta é
somente leitura: não abre o quadro no editor, não sincroniza alterações e exige
o esquema no Supabase. Ela não altera os dados do navegador.

[sync-reconcile.js](sync-reconcile.js) prepara um plano de reconciliação entre
a última versão comum e as versões local e remota, identificando conflitos e
ausências remotas sem sobrescrevê-las. Esse planejamento ainda não está
conectado ao editor, não executa operações e não ativa a sincronização.

[sync-engine.js](sync-engine.js) é uma preparação não ativada que usa esse
plano para ler e gravar revisões, verificar arquivos e interromper operações
quando a conta ou os dados locais mudam. A exclusão lógica preserva o documento
e os anexos na nuvem e é controlada por revisão. Os módulos
[sync-account-store.js](sync-account-store.js) e
[sync-account-adapter.js](sync-account-adapter.js) fornecem persistência
transacional separada por conta, anexos imutáveis e arquivamento de quadros
excluídos. Esses módulos ainda não estão conectados ao editor, à migração nem
a uma interface de resolução de conflitos. Os testes usam um servidor simulado
e também verificam o IndexedDB em um navegador local. **Não carregue esses
módulos no site como sincronização pronta.**
