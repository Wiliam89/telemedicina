# ADR-0011 - Assinatura ICP-Brasil em nuvem, com o documento ficando aqui

**Status:** aceita
**Data:** 2026-09-01
**Modulo do curso:** 9

## Contexto

O Modulo 8 tornou o documento imutavel e conferivel por codigo. Falta o que
lhe da valor legal: a assinatura digital com certificado ICP-Brasil. Sem
ela, a certificacao SBIS/CFM fica no NGS1, e a clinica continua obrigada a
imprimir e assinar a caneta - o que inviabiliza telemedicina de verdade.

Havia tres caminhos possiveis, e um quarto que consideramos e recusamos.

## Decisao

### 1. Certificado em nuvem (A3 em nuvem), nao token fisico

O certificado fica no cofre do provedor (BirdID, VIDaaS, SafeID) e o medico
autoriza cada assinatura com um codigo de 6 digitos no aplicativo. As
alternativas eram A1 em arquivo (que obrigaria a plataforma a guardar a
chave privada do medico - inaceitavel) e A3 em token (que obrigaria o
medico a instalar programa e plugar um dispositivo, o que nao funciona em
atendimento por celular).

### 2. So o HASH sai daqui

A API envia ao provedor apenas o resumo criptografico do que sera assinado,
em hexadecimal. O PDF - que contem o dado clinico - nunca sai da nossa
infraestrutura. Isso nao e detalhe: significa que o provedor de assinatura
nao vira operador de dado de saude, e que uma falha dele nao expoe
prontuario nenhum.

### 3. Recusamos delegar a emissao a uma plataforma de prescricao

Foi considerado usar Memed ou similar para emitir E assinar as receitas. As
vantagens sao reais (rede de farmacias, banco de medicamentos), mas o custo
tambem: o conteudo clinico passaria a sair daqui, e a plataforma externa
viraria a fonte da verdade do documento - com numeracao, validacao e
historico proprios, concorrendo com os nossos. Num sistema que precisa
resistir a pericia, duas fontes da verdade sao pior que uma.

Alem disso, isso resolveria apenas receitas: atestado, relatorio e pedido
de exame continuariam precisando de assinatura propria.

Fica registrado como possivel integracao futura, se a aceitacao em farmacia
se mostrar um problema pratico.

### 4. O PDF e reproduzido, nao remontado

Na hora de assinar, o PDF e gerado a partir do MESMO texto canonico cujo
hash foi guardado na emissao (Modulo 8). Nada e recomposto a partir do
banco: o que se assina e o que foi emitido. A geracao e determinista - os
mesmos dados produzem os mesmos bytes - para que isso seja verificavel.

### 5. Conferimos a assinatura antes de guardar

Depois de embutir o CMS no PDF, a API verifica: recalcula o hash do
ByteRange, confere contra o messageDigest do CMS e valida a assinatura RSA
com a chave publica do certificado. So entao grava. Guardar sem conferir
seria confiar que a biblioteca e o provedor acertaram - e a plataforma nao
tem esse direito.

### 6. O arquivo tem hash proprio, guardado no banco

`documentos.arquivo_hash` e o SHA-256 do PDF assinado. Antes de entregar o
download, a API recalcula e compara: se o arquivo no armazenamento nao for
mais o mesmo, o download e recusado e o incidente aparece. Sem isso, trocar
o arquivo no balde passaria despercebido.

### 7. Balde privado e link temporario

O PDF fica em balde privado do Supabase Storage. O acesso e sempre por URL
assinada de 5 minutos, gerada depois de a API conferir quem pediu (so o
paciente e o medico do documento). Balde publico significaria que qualquer
pessoa com o endereco le a receita de qualquer paciente - e endereco vaza.

### 8. O CPF do certificado tem de ser o do medico

A API recusa assinar se o CPF informado divergir do cadastro, e guarda o
titular como consta NO CERTIFICADO (`assinante_nome`, `assinante_cpf`),
separado do nosso cadastro. A divergencia entre os dois e justamente o que
precisa ser detectavel depois.

### 9. O provedor de teste nao sobe em producao

`local_teste` assina com certificado gerado na hora: criptograficamente
valido, fora da cadeia ICP-Brasil, sem valor legal. Ele existe para que o
projeto rode inteiro sem contrato com ninguem. A API se recusa a iniciar
com ele quando `NODE_ENV=production`, e o `pnpm verificar` avisa sempre que
ele estiver ativo.

### 10. As credenciais podem ser da plataforma OU da clinica

O `client id`/`client secret` identifica a APLICACAO no provedor, nao a
clinica - uma instalacao da plataforma poderia ter um so. Mas a decisao de
quem contrata o provedor e comercial, nao tecnica: ha clinicas que vao
querer contrato proprio (fatura no nome delas, responsabilidade delas) e ha
as que preferem que a plataforma cuide.

Suportamos as duas: a clinica que tiver credenciais proprias as cadastra
(colunas em `clinicas`); a que nao tiver usa as da plataforma. Trocar de
modelo depois nao exige migracao.

O client secret e cifrado com AES-256-GCM antes de tocar o banco, e a
chave vive em `apps/api/.env` - fora do banco, que e o ponto: um dump do
banco nao serve para nada sem ela. GCM porque ele detecta alteracao: mexer
num byte faz a decifragem falhar em vez de devolver lixo.

E, como o RLS decide linhas e nao colunas, a migracao 0013 revoga o SELECT
da tabela `clinicas` e o devolve coluna a coluna, deixando as quatro de
credencial de fora. Nem o administrador da clinica ve o segredo - so a API.

Os CREDITOS de assinatura, em qualquer dos modelos, saem do certificado do
MEDICO. A credencial da aplicacao apenas autoriza o software a pedir.

## Consequencias

- Positivas: o documento passa a valer; o prontuario nao sai da nossa
  infraestrutura; trocar de provedor e escrever uma classe.
- Negativas: cada medico precisa do proprio certificado, e isso e atrito de
  adocao real - vale orientar os clientes sobre o certificado gratuito do
  CFM. Cada assinatura consome credito do certificado do medico.
- Pendente: a verificacao NAO confere hoje se o certificado pertence a
  cadeia ICP-Brasil nem se foi revogado - isso exige as ACs raiz e consulta
  de LCR/OCSP, e entra junto com a producao (Modulo 18). Ate la, a
  plataforma confia no provedor quanto a validade da cadeia.
