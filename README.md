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
- No celular, arraste uma área vazia para navegar pelo quadro sem reduzir o texto; use o botão de centralizar para visualizar todas as notas.
- Crie outros quadros na barra lateral. O botão de download exporta o quadro atual em JSON.
- Clique em **entrelinhas** para acessar todos os quadros e adicionar ou alterar a imagem de capa de cada um.
- Antes de migrar, use **Backup completo** para baixar um JSON com o estado original e todos os arquivos do IndexedDB, incluindo arquivos sem referência. Abra o site na mesma origem e navegador em que os dados foram criados; `localhost` e GitHub Pages não compartilham armazenamento. Feche outras abas e não edite enquanto o backup é gerado. Confira o download e os eventuais alertas de arquivos ausentes. Não há restauração automática implementada.

O backup contém dados privados em texto e anexos codificados em base64; guarde-o em local seguro. Arquivos grandes podem exigir bastante memória e espaço. Imagens que existem apenas como links externos permanecem como links; o conteúdo externo não é baixado. O backup preserva o texto original de `entrelinhas-boards-v1`, bem como identificadores, tipos, nomes, tamanhos, datas e hashes dos arquivos locais.

Os quadros são salvos no armazenamento local do navegador e os arquivos anexados no IndexedDB, neste dispositivo. Limpar os dados do navegador pode apagá-los; não há sincronização entre dispositivos nem importação do JSON exportado. O arquivo exportado inclui os anexos e a capa, inclusive dentro das pastas; vídeos grandes podem gerar arquivos JSON muito grandes. A fonte e a imagem do quadro de exemplo são carregadas da internet quando disponíveis.

## Preparação do Supabase

O arquivo [supabase-setup.sql](supabase-setup.sql) prepara tabelas, convites por e-mail confirmado, regras de acesso, um bucket privado e notificações de alterações. Execute-o uma vez no SQL Editor do projeto. Antes de executar, confira que não existem tabelas ou políticas com os mesmos nomes. O script interrompe a operação se o bucket existente for público. Os limites de upload dependem também da configuração e do plano do Supabase.

Essa preparação **não integra o site à nuvem**: login, migração dos quadros locais, interface de convites, sincronização e tratamento de conflitos ainda precisam ser implementados. Convites são registros de permissão; o script não envia e-mails. A futura integração deve armazenar arquivos em `<id-do-quadro>/<nome-do-arquivo>`, usar `entrelinhas_save_board` com a revisão atual e tratar conflitos sem perder alterações. Não use a chave secreta ou `service_role` no navegador.
