export const UNITS_RU={'g/L':'г/л','10^12/L':'10¹²/л','10^9/L':'10⁹/л','fL':'фл','pg':'пг','µg/L':'мкг/л','µmol/L':'мкмоль/л','mg/L':'мг/л','pg/mL':'пг/мл','pmol/L':'пмоль/л','ng/mL':'нг/мл','nmol/L':'нмоль/л','mm/h':'мм/ч','mL/min/1.73m²':'мл/мин/1,73 м²','mIU/L':'мМЕ/л','U/L':'Ед/л'};
export const LABELS_RU={hemoglobin:'Гемоглобин',RBC:'Эритроциты',MCV:'Средний объём эритроцита',MCH:'Гемоглобин в эритроците',MCHC:'Концентрация гемоглобина в эритроцитах',RDW:'Распределение эритроцитов по объёму',WBC:'Лейкоциты',platelets:'Тромбоциты',active_B12:'Активный витамин B12',TIBC:'Общая железосвязывающая способность',UIBC:'Ненасыщенная железосвязывающая способность',vitamin_B6:'Витамин B6',CRP:'С-реактивный белок',Ret_He:'Гемоглобин ретикулоцитов'};

// Display-only abbreviations: source column keys and import aliases stay unchanged.
export const LAB_ABBREVIATIONS={hemoglobin:'Hb / HGB',RBC:'RBC',hematocrit:'HCT',MCV:'MCV',MCH:'MCH',MCHC:'MCHC',RDW:'RDW-CV',platelets:'PLT',WBC:'WBC',reticulocytes:'RET',ferritin:'FERR',serum_iron:'Fe',transferrin:'TRF',TIBC:'ОЖСС / TIBC',UIBC:'НЖСС / UIBC',TSAT:'TSAT',sTfR:'sTfR',Ret_He:'Ret-He',vitamin_B12:'B12',active_B12:'holoTC',MMA:'MMA',homocysteine:'HCY',folate:'FOL',vitamin_B6:'B6 / PLP',copper:'Cu',ceruloplasmin:'CP',CRP:'СРБ / CRP',ESR:'СОЭ / ESR',creatinine:'CREA',eGFR:'рСКФ / eGFR',TSH:'ТТГ / TSH',albumin:'ALB',LDH:'ЛДГ / LDH',indirect_bilirubin:'IBIL',haptoglobin:'HAPT'};
export function inputLabel(f){
 const fullNames={active_B12:'Активный витамин B12 — холотранскобаламин',vitamin_B6:'Витамин B6 — пиридоксаль-5-фосфат',CRP:'С-реактивный белок'};
 const name=fullNames[f.key]??f.original_label??f.label;
 return LAB_ABBREVIATIONS[f.key]?`${name} (${LAB_ABBREVIATIONS[f.key]})`:name;
}
