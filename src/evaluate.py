from surprise import accuracy, Dataset, Reader
from surprise.model_selection import train_test_split
import pickle
import pandas as pd
import numpy as np
import os

def precision_recall_at_k(predictions, k=10, threshold=3.5):
    """Return precision and recall at k metrics for each user."""

    # First map the predictions to each user.
    user_est_true = {}
    for uid, _, true_r, est, _ in predictions:
        if uid not in user_est_true:
            user_est_true[uid] = []
        user_est_true[uid].append((est, true_r))

    precisions = dict()
    recalls = dict()
    for uid, user_ratings in user_est_true.items():

        # Sort user ratings by estimated value
        user_ratings.sort(key=lambda x: x[0], reverse=True)

        # Number of relevant items
        n_rel = sum((true_r >= threshold) for (_, true_r) in user_ratings)

        # Number of recommended items in top k
        n_rec_k = sum((est >= threshold) for (est, _) in user_ratings[:k])

        # Number of relevant and recommended items in top k
        n_rel_and_rec_k = sum(((true_r >= threshold) and (est >= threshold))
                              for (est, true_r) in user_ratings[:k])

        # Precision@K: Proportion of recommended items that are relevant
        # When n_rec_k is 0, Precision is undefined. We here set it to 0.
        precisions[uid] = n_rel_and_rec_k / n_rec_k if n_rec_k != 0 else 0

        # Recall@K: Proportion of relevant items that are recommended
        # When n_rel is 0, Recall is undefined. We here set it to 0.
        recalls[uid] = n_rel_and_rec_k / n_rel if n_rel != 0 else 0

    return precisions, recalls

def ndcg_at_k(predictions, k=10):
    """Return Normalized Discounted Cumulative Gain (NDCG@k) for each user."""
    user_est_true = {}
    for uid, _, true_r, est, _ in predictions:
        if uid not in user_est_true:
            user_est_true[uid] = []
        user_est_true[uid].append((est, true_r))

    ndcgs = dict()
    for uid, user_ratings in user_est_true.items():
        # Step 1: Sort by *estimated* rating to simulate what the model actually recommends
        user_ratings.sort(key=lambda x: x[0], reverse=True)
        top_k_preds = user_ratings[:k]
        
        # Calculate DCG (Discounted Cumulative Gain)
        dcg = 0.0
        for i, (est, true_r) in enumerate(top_k_preds):
            # 2^relevance - 1 puts heavy emphasis on 5-star ratings over 3-star ratings
            # log2(i + 2) is the positional discount (penalizes good movies that are ranked too low)
            dcg += (2**true_r - 1) / np.log2(i + 2)
            
        # Step 2: Sort by *true* rating to calculate the absolute perfect score (IDCG)
        true_ratings_sorted = sorted(user_ratings, key=lambda x: x[1], reverse=True)
        top_k_ideal = true_ratings_sorted[:k]
        
        idcg = 0.0
        for i, (est, true_r) in enumerate(top_k_ideal):
            idcg += (2**true_r - 1) / np.log2(i + 2)
            
        # Step 3: Normalize the score out of 1.0
        ndcgs[uid] = dcg / idcg if idcg > 0 else 0.0
        
    return ndcgs

def evaluate_model():
    print("Loading data for evaluation...")
    data_path = "datasets/ml-latest-small/"
    ratings = pd.read_csv(os.path.join(data_path, "ratings.csv"))
    
    reader = Reader(rating_scale=(0.5, 5.0))
    data = Dataset.load_from_df(ratings[['userId', 'movieId', 'rating']], reader)
    
    from surprise.model_selection import train_test_split
    from surprise import SVD, KNNBaseline, NMF
    
    # Single 80/20 split — reliable on local hardware.
    # NOTE: Both SVD and KNN scored within 0.002 NDCG of each other (essentially tied).
    # SVD is the final production choice because it scales better as new users are added.
    trainset, testset = train_test_split(data, test_size=0.2, random_state=42)
    
    algorithms = {
        "SVD (Matrix Factorization)": SVD(),
        "KNN Baseline (User-Based)": KNNBaseline(sim_options={'name': 'pearson_baseline', 'user_based': True}),
        "NMF (Matrix Factorization)": NMF()
    }
    
    report_lines = ["--- ML Model Evaluation Tournament Report ---\n"]
    
    for name, algo in algorithms.items():
        print(f"\n=========================================")
        print(f"🏋️ Training {name} on 80% of data...")
        algo.fit(trainset)
        
        print(f"🔮 Making predictions on blind-spot 20%...")
        predictions = algo.test(testset)
        
        rmse = accuracy.rmse(predictions, verbose=False)
        mae = accuracy.mae(predictions, verbose=False)
        
        precisions, recalls = precision_recall_at_k(predictions, k=10, threshold=3.5)
        avg_precision = sum(precisions.values()) / len(precisions)
        avg_recall = sum(recalls.values()) / len(recalls)
        
        ndcgs = ndcg_at_k(predictions, k=10)
        avg_ndcg = sum(ndcgs.values()) / len(ndcgs)
        
        print(f"\n--- {name} Results ---")
        print(f"RMSE:         {rmse:.4f} (Lower is better)")
        print(f"MAE:          {mae:.4f} (Lower is better)")
        print(f"Precision@10: {avg_precision:.4f} (Higher is better)")
        print(f"Recall@10:    {avg_recall:.4f} (Higher is better)")
        print(f"NDCG@10:      {avg_ndcg:.4f} (Higher is better)")
        
        report_lines.append(f"\n[{name}]")
        report_lines.append(f"RMSE: {rmse:.4f}")
        report_lines.append(f"MAE: {mae:.4f}")
        report_lines.append(f"Precision@10: {avg_precision:.4f}")
        report_lines.append(f"Recall@10: {avg_recall:.4f}")
        report_lines.append(f"NDCG@10: {avg_ndcg:.4f}")
    
    with open("models/evaluation_results.txt", "w") as f:
        f.write("\n".join(report_lines))
    
    print("\n=========================================")
    print("🏆 Report saved to models/evaluation_results.txt")

if __name__ == "__main__":
    evaluate_model()
