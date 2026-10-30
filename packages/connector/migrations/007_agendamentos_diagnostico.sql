-- Diagnóstico da gravação na Asa (tempo de cada etapa, erro de rede, ids não pessoais do pedido).
-- Serve para entender marcações incertas; não guarda nome, CPF nem telefone.
ALTER TABLE agendamentos ADD COLUMN diagnostico text;
