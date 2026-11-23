-- As telas mostram o nome do sistema que a clínica usa ("ClinFy + Luna", "no Luna"), não o da empresa.
-- A Avelar é a fornecedora; o sistema é o Luna. O slug continua 'avelar' (tenants.erp aponta para ele).
UPDATE conectores SET nome = 'Luna', artigo = 'o', atualizado_em = now()
 WHERE slug = 'avelar' AND nome = 'Avelar';
