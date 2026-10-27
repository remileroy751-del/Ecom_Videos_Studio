# EcomVideoStudio — v1.8.0
Logiciel desktop de montage vidéo pour Windows 10+ (Electron + FFmpeg).

## Nouveautés v1.8.0 / What's new
- **Raccourcis clavier** : **Ctrl+Z** annule jusqu'aux 10 dernières actions (Ctrl+Y ou Ctrl+Maj+Z pour rétablir) ; **K** coupe le clip sélectionné à la tête de lecture (vidéo, audio ou photo).
- **Mode IA** (onglet sous Transitions, et bouton sur la page d'accueil) : crée un short vidéo 9:16 de 90 secondes maximum, étape par étape :
  1. script de 900 caractères maximum lu par une voix off **féminine ou masculine** (voix Windows hors ligne, ou voix IA naturelles Gemini) — ou voix off enregistrée de 1 min 30 maximum ;
  2. musique de fond choisie sur l'ordinateur (ou aucune), répétée si besoin ;
  3. 4 images ou 4 vidéos au maximum (la première est répétée si la durée est plus courte que la voix off) ;
  4. style (8 modèles) et position des sous-titres ;
  5. « Créer la vidéo » : montage automatique avec transitions, progression de 0 à 100 %, puis « Terminé — Ouvrir le dossier ». La vidéo est enregistrée dans `Vidéos\EcomVideoStudio\Exports` et le projet dans la liste des projets.
- Voix Windows : pour le français, installez une voix française dans les paramètres Windows (Heure et langue > Voix) si elle n'est pas déjà présente ; sinon utilisez les voix IA Gemini (clé gratuite).

## Nouveautés v1.7.0 / What's new
- **Page d'accueil façon CapCut** : un grand bouton **Nouveau projet** en haut, les projets précédents en dessous (un clic pour les rouvrir, corbeille pour les supprimer). Bouton **Accueil** dans l'éditeur.
- **Dossier automatique** `Vidéos\EcomVideoStudio` (sous-dossiers `Projets` et `Exports`), créé au premier lancement qui suit l'installation. Les projets y sont enregistrés ; les exports proposent ce dossier par défaut.
- **Enregistrement automatique toutes les 15 secondes**, avec l'heure affichée en haut du projet ; le nom du projet se modifie directement en haut.
- **Mode clair / sombre** : bouton soleil/lune à côté du choix de langue (choix mémorisé).
- **Bouton Actualiser** (flèches circulaires, en haut) : réinitialise l'aperçu et tous les lecteurs comme si le projet était fermé puis rouvert (utile si l'aperçu devient noir). Reprise automatique en cas d'erreur de lecture et libération des décodeurs inutilisés.
- **Légendes sur 2 lignes** maximum, coupées automatiquement et ajustées pour ne plus déborder du cadre, quel que soit le format.

## Nouveautés v1.6.0 / What's new
- **Réglages de l'image** (panneau de droite, pour une vidéo ou une photo) : contraste, luminosité, netteté, saturation — visibles en direct et appliqués à l'export.
- **Légendes automatiques ajoutées au projet** : après « Générer les légendes », chaque légende devient un clip texte sur la nouvelle piste **CC** de la timeline (comme CapCut). Cliquez sur une légende pour modifier son texte, son style, sa position ou ses bords ; un bouton applique son style à toutes les légendes.
- **8 styles de légendes** à choisir **avant** de générer (police, couleur, contour, ombre, fond) + position (bas / milieu / haut).
- **Textes** : la taille ne dépend plus de la longueur du texte (changer le texte ne le rétrécit plus). La piste CC accueille les textes, légendes et stickers.
- Export rapide même avec des centaines de légendes.

## Nouveautés v1.5.0 / What's new
- **Pistes V1, V2, V3** : bouton **œil** (masquer / afficher la piste) et bouton **haut-parleur** (couper / activer le son). Les pistes audio A1 à A3 ont aussi leur haut-parleur. Une piste masquée ou muette est aussi ignorée à l'export.
- **Déplacement des clips à la souris** comme dans CapCut : glisser-déposer sur la même piste ou vers une autre, aimantation aux bords des autres clips et à la tête de lecture ; déposer un clip sur un autre l'**insère** avant ou après (les clips suivants sont décalés).
- **Médias** : bouton **corbeille** sur chaque média. Si le média est utilisé dans le montage, un message demande « Ce média se trouve dans le montage. Supprimer ? » (Oui / Non) ; en cas de Oui, il disparaît aussi du montage.
- **Lecture plus fluide** : préchargement du clip suivant (changement de clip sans coupure), synchronisation douce de l'image et du son, copies d'aperçu légères (540p) créées automatiquement pour les vidéos lourdes (l'export utilise toujours les originaux), interface allégée pendant la lecture.

## Nouveautés v1.4.0 / What's new
- **Installateur bilingue** : au lancement du setup, choix de la langue **Français / English**, puis installation. Le logiciel démarre dans la langue choisie ; le bouton **FR | EN** en haut permet d'en changer à tout moment.
- **Export en 480p, 720p ou 1080p** (dans le format 9:16, 16:9, 4:5 ou 1:1 du projet).
- **Onglet Audio supprimé** : l'onglet **Médias** importe vidéos, photos et audios (filtres Tous / Vidéos / Photos / Audios).
- **Transitions (23)** : fondu, fondu au noir, flash blanc, pousser/glisser (4 directions), volets, iris, zooms, rotation et **3D** (retournement, bascule, cube, cube vertical, porte). Deux clips côte à côte sur la même piste, sélection, clic sur la transition ; durée réglable à droite.
- **Textes (16 styles)** : polices, couleurs et effets différents ; ajout par clic ou glisser-déposer ; texte, police, couleurs, dégradé, contour, ombre/lueur, fond, espacement, taille, animation modifiables à droite et déplaçables dans l'aperçu.
- **Flèches ← →** : la tête de lecture avance/recule de 1 seconde (Maj + flèche : 1 image).
- **Légendes automatiques : 5 plateformes** — gratuites : **Groq**, **Google Gemini**, **Mistral Voxtral** ; payantes : **OpenAI**, **Deepgram**. Une clé API par plateforme.

## Nouveautés v1.3.0
- **Logo et icône** du logiciel : lettre E + pellicule rouge 3D (fenêtre, installeur, raccourcis).
- **Pied de page** : « Créé par Ecom Academy • Mail : ecom.academy.tg@gmail.com ».
- **Onglet Effets : 41 effets** (couleur, film, mouvement, ambiance dont flammes, étincelles, neige, pluie, confettis…). Sélectionnez un clip, cliquez sur un effet : il s'applique à tout le clip (jusqu'à 4 par clip). Recliquez pour le retirer.
- **Déplacement direct dans l'aperçu** : cliquez un clip ou un sticker dans l'aperçu, glissez-le pour le déplacer, tirez un coin pour changer sa taille.

## Nouveautés v1.2.0
- **Format du projet** sous l'aperçu : 9:16, 16:9, 4:5 ou 1:1 (l'aperçu et l'export suivent le format choisi).
- **Panneau de réglages à droite** : volume, taille, position, Ajuster/Remplir, durée et animation du clip sélectionné. L'aperçu est plus compact.
- **Aperçu immédiat** : un média ajouté s'affiche tout de suite dans l'aperçu (la tête de lecture se place sur le clip) et la timeline montre des vignettes.
- **Onglet Stickers** : 30 stickers animés (apparition « pop », mouvement en boucle, disparition) de 3 s, ajoutables par clic ou glisser-déposer sur V1 à V3, réglables et exportés dans la vidéo.

## Nouveautés v1.1.0
- **3 pistes vidéo superposables (V1, V2, V3)** : glissez des vidéos ou des photos depuis l'onglet Médias (ou depuis l'Explorateur Windows) sur une piste. V3 passe au-dessus de V2, qui passe au-dessus de V1.
- **3 pistes audio** : A1 par défaut ; A2 et A3 se créent en glissant un son sur la zone « nouvelle piste » ou avec le bouton **＋ Ajouter piste audio**.
- Réglages par clip : volume, taille, position (incrustation façon CapCut), rognage par les bords, coupe à la tête de lecture, déplacement entre pistes.
- **Légendes automatiques** : bouton « Générer les légendes » (onglet Légendes). Transcription en ligne (Whisper via Groq, clé gratuite, ou OpenAI), légendes éditables, incrustées dans l'export.
- Export MP4 H.264 (480p / 1080p) avec toutes les pistes mixées.

## Légendes : configuration (une seule fois)
1. Créez une clé API gratuite sur https://console.groq.com/keys (ou utilisez une clé OpenAI).
2. Onglet **Légendes** → collez la clé → **Enregistrer la clé**.
3. Choisissez la langue puis **Générer les légendes**.

## GitHub
Déposez tout le contenu à la racine du dépôt, puis poussez sur `main`. Le workflow `.github/workflows/build-windows.yml` compile l'installateur (publication GitHub d'electron-builder désactivée : `--publish never`) et le met dans l'artefact `EcomVideoStudio-Windows` et dans une Release.

## Raccourcis
Espace : lecture/pause • Suppr : supprimer le clip sélectionné.

## Développement local
npm install
npm start
npm run dist
