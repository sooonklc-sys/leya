"""Reproducible prototype; raw patient rows are never exported into the website."""
import argparse, json, hashlib
from pathlib import Path
import numpy as np
import pandas as pd
import openpyxl
from sklearn.ensemble import RandomForestClassifier
from sklearn.impute import SimpleImputer
from sklearn.pipeline import make_pipeline
from sklearn.model_selection import train_test_split, StratifiedKFold, cross_val_predict
from sklearn.metrics import accuracy_score, f1_score, classification_report, confusion_matrix, recall_score
import sklearn

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument('--data', required=True)
parser.add_argument('--dictionary', required=True)
parser.add_argument('--audit-dir', required=True)
args = parser.parse_args()
audit = Path(args.audit_dir); audit.mkdir(parents=True, exist_ok=True)
d = pd.read_csv(args.data)
labs = list(d.columns[3:38])
basic = ['hemoglobin','RBC','hematocrit','MCV','MCH','MCHC','RDW','platelets','WBC']
targets = ['iron_deficiency','B12_deficiency','folate_deficiency','B6_deficiency','copper_deficiency','inflammation_anemia']
assert len(d) == 840 and len(labs) == 35
assert d.patient_id.nunique() == len(d)
assert ((d.hemoglobin < d.sex.map({'F':120,'M':130})).astype(int) == d.anemia).all()
X = d[['age_years','sex']+labs].copy(); X['sex'] = X.sex.map({'F':0,'M':1})
y = d.anemia_class
train, test = train_test_split(np.arange(len(d)), test_size=.25, random_state=20261003, stratify=y)
cv = StratifiedKFold(n_splits=4, shuffle=True, random_state=20261004)

def pipeline(depth, leaf):
    return make_pipeline(SimpleImputer(strategy='median'),RandomForestClassifier(n_estimators=80,max_depth=depth,min_samples_leaf=leaf,class_weight='balanced_subsample',random_state=20261003,n_jobs=2))

def scores(ytrue, pred):
    return {'accuracy':float(accuracy_score(ytrue,pred)), 'macro_f1':float(f1_score(ytrue,pred,average='macro',zero_division=0))}

def serialize(pipe, columns):
    forest=pipe[-1]
    output={'features':columns,'medians':pipe[0].statistics_.tolist(),'classes':[str(x) for x in forest.classes_],'trees':[], 'feature_importances':dict(zip(columns,forest.feature_importances_.tolist()))}
    for est in forest.estimators_:
        t=est.tree_
        vals=t.value[:,0,:]; vals=vals/vals.sum(axis=1,keepdims=True)
        output['trees'].append({'left':t.children_left.tolist(),'right':t.children_right.tolist(),'feature':t.feature.tolist(),'threshold':t.threshold.tolist(),'value':vals.tolist()})
    return output

class_flags=d.groupby('anemia_class')[targets].first()
assert all(d.groupby('anemia_class')[t].nunique().max()==1 for t in targets if t not in ['iron_deficiency','B12_deficiency','folate_deficiency'])
# Mixed classes need separate multilabel estimators: cause combinations differ inside mixed_deficiency.
def serialize_binary(pipe, columns):
    return serialize(pipe,columns)

model={'version':'1.0.0','seed':20261003,'targets':targets,'variants':{},'metrics':{},'total_records':len(d),'train_records':len(train),'test_records':len(test),'anemia_rule':{'F':120,'M':130}}
checks=[]
for name,columns in [('cbc',['age_years','sex']+basic),('extended',list(X.columns))]:
    trials=[]
    for depth,leaf in [(7,4),(11,2)]:
        candidate=pipeline(depth,leaf)
        pred=cross_val_predict(candidate,X.iloc[train][columns],y.iloc[train],cv=cv,n_jobs=1)
        trials.append({'depth':depth,'leaf':leaf,**scores(y.iloc[train],pred)})
    best=max(trials,key=lambda v:v['macro_f1'])
    fitted=pipeline(best['depth'],best['leaf']).fit(X.iloc[train][columns],y.iloc[train])
    pred=fitted.predict(X.iloc[test][columns])
    p=fitted.predict_proba(X.iloc[test][columns])
    metrics={**scores(y.iloc[test],pred),'cv_candidates':trials,'selected':best,'per_class':classification_report(y.iloc[test],pred,output_dict=True,zero_division=0),'confusion_matrix':confusion_matrix(y.iloc[test],pred,labels=fitted[-1].classes_).tolist(),'class_order':fitted[-1].classes_.tolist()}
    out={'classifier':serialize(fitted,columns),'deficits':{}}
    deficit_metrics={}
    for target in targets:
        fitted_binary=pipeline(best['depth'],best['leaf']).fit(X.iloc[train][columns],d.iloc[train][target])
        binary_pred=fitted_binary.predict(X.iloc[test][columns])
        out['deficits'][target]=serialize_binary(fitted_binary,columns)
        nonanemic=(d.iloc[test].anemia==0).to_numpy()
        deficit_metrics[target]={'positive_test_records':int(d.iloc[test][target].sum()),'recall':float(recall_score(d.iloc[test][target],binary_pred,zero_division=0)),'f1':float(f1_score(d.iloc[test][target],binary_pred,zero_division=0)),'nonanemic_positive_test_records':int(d.iloc[test].loc[d.iloc[test].anemia==0,target].sum()),'nonanemic_recall':float(recall_score(d.iloc[test][target].to_numpy()[nonanemic],binary_pred[nonanemic],zero_division=0))}
    metrics['deficits']=deficit_metrics
    if name=='extended':
        rng=np.random.default_rng(77); masked=X.iloc[test][columns].copy()
        extra=[c for c in labs if c not in basic]
        for col in extra: masked.loc[rng.random(len(masked))<.5,col]=np.nan
        metrics['extra_mask_50pct']=scores(y.iloc[test],fitted.predict(masked))
    range_columns=[c for c in columns if c in labs]
    range_values=d.iloc[test][range_columns]
    outside=((range_values<d.iloc[train][range_columns].min())|(range_values>d.iloc[train][range_columns].max())).any(axis=1)
    metrics['within_training_ranges_records']=int((~outside).sum())
    metrics['outside_training_ranges_records']=int(outside.sum())
    metrics['within_training_ranges_scores']=scores(y.iloc[test].to_numpy()[~outside],pred[~outside])
    model['variants'][name]=out;model['metrics'][name]=metrics
    for idx in test[:8]:
        # Temporary parity fixtures, kept outside deliverables and hosting checkout.
        row=X.loc[idx,columns]
        checks.append({'variant':name,'input':{k:None if pd.isna(v) else float(v) for k,v in row.items()},'expected':fitted.predict_proba(X.loc[[idx],columns])[0].tolist()})
    print(name,json.dumps({k:metrics[k] for k in ['accuracy','macro_f1','selected']},ensure_ascii=False),flush=True)

# Mask-only baseline quantifies a shortcut from test-ordering patterns, train split only.
presence = X.notna().astype(float).drop(columns=['age_years','sex'])
shortcut=RandomForestClassifier(n_estimators=80,max_depth=7,min_samples_leaf=4,random_state=20261003,n_jobs=2)
shortcut.fit(presence.iloc[train],y.iloc[train])
model['missingness_only_metrics']=scores(y.iloc[test],shortcut.predict(presence.iloc[test]))
model['limitations']=['One small supplied dataset; provenance and label verification are not documented.','Single stratified 25% holdout; model selection on training-only 4-fold CV.','No external clinical validation or probability calibration.','Missingness is associated with labels; ordering-pattern shortcut risk.','The deployed models are trained on 630 rows; the 210-row holdout is not used for fitting.','Unit dictionary does not provide clinical reference intervals.']
model['data_sha256']=hashlib.sha256(Path(args.data).read_bytes()).hexdigest()
model['sklearn_version']=sklearn.__version__
dist=ROOT/'dist'
(dist/'model.json').write_text(json.dumps(model,ensure_ascii=False,separators=(',',':'),allow_nan=False),encoding='utf-8')
(audit/'parity.json').write_text(json.dumps(checks,allow_nan=False),encoding='utf-8')
summary={k:v for k,v in model.items() if k!='variants'}
(ROOT/'model-evaluation.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2),encoding='utf-8')
ws=openpyxl.load_workbook(args.dictionary,read_only=True,data_only=True)['Variables']
dictionary={r[0]:{'label':r[1].strip(),'unit':r[2]} for r in list(ws.values)[1:]}
schema={'fields':[{'key':c,**dictionary[c],'observed_min':float(d.iloc[train][c].min()),'observed_max':float(d.iloc[train][c].max()),'missing':int(d[c].isna().sum())} for c in labs],'basic':basic,'input_metadata':['age_years','sex'],'ignored':list(d.columns[38:])+['patient_id'],'records':len(d),'range_source':'training_split_only'}
(dist/'schema.json').write_text(json.dumps(schema,ensure_ascii=False,indent=2),encoding='utf-8')
# Empty input template, never a copy of patient records.
(dist/'template.csv').write_text('\ufeff'+','.join(['age_years','sex']+labs)+'\n',encoding='utf-8')
print('MODEL_BYTES',(dist/'model.json').stat().st_size,flush=True)
print('MISSINGNESS_ONLY',model['missingness_only_metrics'],flush=True)
